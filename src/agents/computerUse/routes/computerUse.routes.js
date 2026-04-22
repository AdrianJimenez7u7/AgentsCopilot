import { Router } from 'express';
import { WebSocketServer } from 'ws';
import { registerBridge } from '../computerUseBridge.service.js';
import {
    runComputerUse,
    cancelComputerUse,
    getBridgeStatus,
    improveGoal,
    getComputerUseModels,
    getComputerUseConfig,
    updateComputerUseConfig,
    getComputerUseUsageSummary,
    getComputerUseActionNotes,
} from '../controllers/computerUse.controller.js';

const router = Router();

// ── REST: run agent (SSE) ────────────────────────────────────────────────────
router.post('/run', runComputerUse);
router.post('/cancel', cancelComputerUse);

// ── REST: bridge status ───────────────────────────────────────────────────────
router.get('/bridge/status', getBridgeStatus);

// ── REST: improve automation goal text ───────────────────────────────────────
router.post('/improve-goal', improveGoal);

// ── REST: runtime config and models ──────────────────────────────────────────
router.get('/config/models', getComputerUseModels);
router.get('/config', getComputerUseConfig);
router.patch('/config', updateComputerUseConfig);
router.get('/config/usage-summary', getComputerUseUsageSummary);
router.get('/actions/notes', getComputerUseActionNotes);

// ── WebSocket: bridge registration ───────────────────────────────────────────
// Called from app.js via upgradeToWS helper — see below
export function attachBridgeWS(server) {
    const wss = new WebSocketServer({ noServer: true });
    const bridgeToken = process.env.COMPUTER_USE_API_KEY;
    const isLocalHost = (host = '') => /^localhost(?::\d+)?$/i.test(host) || /^127\.0\.0\.1(?::\d+)?$/i.test(host);

    server.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const pathname = url.pathname;
        if (pathname.replace(/\/+$/, "") === '/agente/computer-use/bridge') {
            const host = (req.headers.host || '').toString();
            const allowLocalWithoutToken = isLocalHost(host);

            if (bridgeToken && !allowLocalWithoutToken) {
                const queryToken = url.searchParams.get('token');
                if (!queryToken || queryToken !== bridgeToken) {
                    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                    socket.destroy();
                    return;
                }
            }
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('connection', ws, req);
            });
        }
    });

    wss.on('connection', (ws, req) => {
        let sessionId = null;

        try {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const querySessionId = String(url.searchParams.get('sessionId') || '').trim();
            if (querySessionId) {
                sessionId = querySessionId;
                registerBridge(sessionId, ws);
                ws.send(JSON.stringify({ type: 'ack', sessionId }));
            }
        } catch {
            // ignore query parse errors and fallback to hello message handshake
        }

        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.type === 'hello' && msg.sessionId) {
                    const host = (req.headers.host || '').toString();
                    const allowLocalWithoutToken = isLocalHost(host);
                    if (bridgeToken && !allowLocalWithoutToken && msg.token && msg.token !== bridgeToken) {
                        ws.close(1008, 'Invalid token');
                        return;
                    }
                    const incomingSessionId = String(msg.sessionId).trim();
                    if (incomingSessionId && incomingSessionId !== sessionId) {
                        sessionId = incomingSessionId;
                        registerBridge(sessionId, ws);
                    }
                    if (sessionId) {
                        ws.send(JSON.stringify({ type: 'ack', sessionId }));
                    }
                }
            } catch { /* ignore */ }
        });

        ws.on('close', () => {
        });
    });

    return wss;
}

export default router;
