#!/usr/bin/env node
/**
 * agent-bridge.js
 * 
 * Runs on the USER's machine. Connects to the AgentsCopilot App Service
 * via WebSocket and uses Playwright to control the user's local Chrome.
 * 
 * Usage:
 *   node agent-bridge.js --server wss://your-app-service.azurewebsites.net --session YOUR_SESSION_ID
 *   node agent-bridge.js --server ws://localhost:3000 --session test-session
 */

import { chromium } from 'playwright';
import WebSocket from 'ws';
import { parseArgs } from 'util';

// ── CLI args ────────────────────────────────────────────────────────────────
const { values: args } = parseArgs({
    args: process.argv.slice(2),
    options: {
        server: { type: 'string', default: process.env.BRIDGE_SERVER ?? 'ws://localhost:3000' },
        session: { type: 'string', default: process.env.BRIDGE_SESSION ?? `session-${Date.now()}` },
    }
});

const SERVER_URL = args.server;
const SESSION_ID = args.session;
const WS_PATH = `${SERVER_URL}/agente/computer-use/bridge`;

const MAX_PARSE_RETRIES = 2;
const MAX_ATTEMPTS = 3;

// ── Playwright helpers ───────────────────────────────────────────────────────
async function extractDOM(page) {
    return page.evaluate(() => {
        const selectors = ['a', 'button', 'input', 'select', 'textarea', "[role='button']", "[role='link']", "[role='textbox']", 'label'];
        const results = [];
        document.querySelectorAll(selectors.join(',')).forEach(el => {
            const tag = el.tagName.toLowerCase();
            const attrs = [];
            for (const attr of ['id', 'name', 'class', 'type', 'href', 'placeholder', 'aria-label', 'role', 'value']) {
                const val = el.getAttribute(attr);
                if (val) attrs.push(`${attr}="${val.slice(0, 80)}"`);
            }
            results.push(`<${tag} ${attrs.join(' ')}>${(el.textContent ?? '').trim().slice(0, 60)}</${tag}>`);
        });
        return results.slice(0, 150).join('\n');
    });
}

async function screenshot(page) {
    const buf = await page.screenshot({ type: 'jpeg', quality: 70 });
    return buf.toString('base64');
}

async function executeCommand(page, cmd) {
    switch (cmd.action) {
        case 'navigate': if (cmd.url) await page.goto(cmd.url, { waitUntil: 'domcontentloaded' }); break;
        case 'type': if (cmd.target) await page.fill(cmd.target, cmd.text ?? ''); break;
        case 'click': if (cmd.target) await page.click(cmd.target); break;
        case 'scroll': await page.evaluate(d => window.scrollBy(0, d), parseInt(cmd.value ?? '500')); break;
        case 'hover': if (cmd.target) await page.hover(cmd.target); break;
        case 'select': if (cmd.target) await page.selectOption(cmd.target, cmd.value ?? ''); break;
        case 'wait': await page.waitForTimeout(parseInt(cmd.value ?? '1000')); break;
        case 'go_back': await page.goBack(); break;
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    let browser = null;
    let page = null;

    // Connect WebSocket to App Service
    const ws = new WebSocket(WS_PATH);

    ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'hello', sessionId: SESSION_ID }));
    });

    ws.on('message', async (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        if (msg.type === 'ack') {
        }

        if (msg.type === 'run') {
            const { goal, steps } = msg;
            let anyFailed = false;

            // Launch user's browser
            if (!browser) {
                browser = await chromium.launch({ headless: false });
                page = await browser.newPage();
                await page.setViewportSize({ width: 1280, height: 800 });
            }

            const send = (data) => ws.send(JSON.stringify({ ...data, sessionId: SESSION_ID }));

            // Send initial screenshot
            send({ type: 'screenshot', data: await screenshot(page) });

            for (const step of steps) {
                send({ type: 'step_start', stepId: step.id, description: step.description });
                let succeeded = false;

                for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
                    try {
                        const dom = await extractDOM(page);

                        // Ask the LLM on the server for the command
                        ws.send(JSON.stringify({ type: 'need_command', sessionId: SESSION_ID, stepId: step.id, description: step.description, dom }));

                        // Wait for the server to respond with the command
                        const command = await waitForCommand(ws, step.id);
                        send({ type: 'command', stepId: step.id, command });

                        await executeCommand(page, command);
                        await page.waitForTimeout(1200);
                        send({ type: 'screenshot', data: await screenshot(page) });

                        const domAfter = await extractDOM(page);
                        ws.send(JSON.stringify({ type: 'need_eval', sessionId: SESSION_ID, stepId: step.id, description: step.description, dom: domAfter }));
                        const ok = await waitForEval(ws, step.id);

                        if (ok) {
                            succeeded = true;
                            send({ type: 'step_done', stepId: step.id, ok: true });
                            break;
                        }
                    } catch (err) {
                        send({ type: 'step_error', stepId: step.id, error: err.message });
                    }
                }

                if (!succeeded) send({ type: 'step_done', stepId: step.id, ok: false });
                if (!succeeded) anyFailed = true;
            }

            send({ type: 'screenshot', data: await screenshot(page) });
            const allOk = !anyFailed;
            send({ type: 'done', success: allOk, summary: steps });
        }
    });

    ws.on('close', () => {
    });
    ws.on('error', (err) => console.error('[Bridge] Error WS:', err.message));
}

// ── Wait helpers ──────────────────────────────────────────────────────────────
function waitForCommand(ws, stepId) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout esperando comando')), 30000);
        const handler = (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'command_response' && msg.stepId === stepId) {
                    clearTimeout(timeout);
                    ws.off('message', handler);
                    resolve(msg.command);
                }
            } catch { /* ignore */ }
        };
        ws.on('message', handler);
    });
}

function waitForEval(ws, stepId) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout esperando eval')), 30000);
        const handler = (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'eval_response' && msg.stepId === stepId) {
                    clearTimeout(timeout);
                    ws.off('message', handler);
                    resolve(msg.ok);
                }
            } catch { /* ignore */ }
        };
        ws.on('message', handler);
    });
}

main().catch(err => {
    console.error('[Bridge] Error fatal:', err.message);
    process.exit(1);
});
