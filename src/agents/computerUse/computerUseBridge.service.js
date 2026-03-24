/**
 * computerUseBridge.service.js
 * Manages WebSocket bridge connections from user machines.
 *
 * Protocol (JSON messages):
 *   bridge→server: { type:'hello', sessionId }
 *                  { type:'screenshot', sessionId, data:<base64 jpeg> }
 *                  { type:'step_start', sessionId, stepId, description }
 *                  { type:'step_done', sessionId, stepId, ok:bool }
 *                  { type:'step_error', sessionId, stepId, error }
 *                  { type:'command', sessionId, stepId, command }
 *                  { type:'done', sessionId, success, summary }
 *                  { type:'need_command', sessionId, stepId, description, dom }
 *                  { type:'need_eval', sessionId, stepId, description, dom }
 *
 *   server→bridge: { type:'ack', sessionId }
 *                  { type:'run', sessionId, goal, steps }
 *                  { type:'command_response', stepId, command }
 *                  { type:'eval_response', stepId, ok:bool }
 */

import { logAgentAction } from '../../shared/services/agentTelemetry.service.js';
import {
    MODEL,
    TELEMETRY_PROJECT,
    TELEMETRY_MODULE,
    TELEMETRY_AGENT_LOGICAL,
    TELEMETRY_AGENT_PUBLIC,
    TELEMETRY_PLATFORM,
} from './services/computerUse.constants.js';
import {
    callLLM,
    safeParseLLMJson,
    normalizeBrowserCommand,
    evaluateStepWithExtraction,
    getRunUsage,
} from './services/computerUse.llm.service.js';
import { getComputerUseRuntimeConfig, isNavigationAllowedByPolicy } from './services/computerUse.config.service.js';

const bridges = new Map(); // sessionId → ws
const normalizeSessionId = (value) => String(value ?? '').trim();

function buildSearchFallback(description = '') {
    const text = String(description || '').toLowerCase();
    const searchIntent = ['buscar', 'search', 'investigar', 'documentacion', 'documentación', 'how to'];
    const nonSearchIntent = ['login', 'iniciar sesion', 'iniciar sesión', 'formulario', 'capturar'];

    if (nonSearchIntent.some((hint) => text.includes(hint))) {
        return { action: 'wait', value: '1200' };
    }

    if (searchIntent.some((hint) => text.includes(hint))) {
        const q = encodeURIComponent(String(description || '').trim());
        return { action: 'navigate', url: `https://www.google.com/search?q=${q}` };
    }

    return { action: 'wait', value: '1200' };
}

const CMD_PROMPT = `Convierte la instruccion en UN SOLO comando de navegador.
Si no hay una URL explicita en el paso, no inventes navegacion; prefiere wait o accion sobre la pagina actual.
Devuelve SOLO JSON valido:
{"action":"click|type|navigate|scroll|hover|select|wait|go_back","target":"css selector","text":"texto","url":"https://...","value":"..."}`;

function applyNavigationPolicyToCommand(command = {}, policy = {}) {
    if (!command || command.action !== 'navigate') return command;

    const validation = isNavigationAllowedByPolicy(command.url, policy);
    if (validation.allowed) return command;

    if (String(policy?.blockBehavior || 'block') === 'skip') {
        return {
            action: 'wait',
            value: '800',
            note: `Navegacion omitida por politica: ${validation.reason}`,
        };
    }

    return {
        action: 'wait',
        value: '1200',
        note: `Navegacion bloqueada por politica: ${validation.reason}`,
    };
}

// ─── Bridge registry ──────────────────────────────────────────────────────────
export function registerBridge(sessionId, ws) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) return;

    const existing = bridges.get(normalizedSessionId);
    if (existing?.readyState === 1) { try { existing.close(); } catch { /* ignore */ } }

    bridges.set(normalizedSessionId, ws);
    console.log(`[Bridge] Connected: ${normalizedSessionId}`);

    // Handle messages from the bridge (LLM relay)
    ws.on('message', async (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (!msg.sessionId) return;
        if (normalizeSessionId(msg.sessionId) !== normalizedSessionId) return;

        if (msg.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', sessionId: normalizedSessionId, ts: Date.now() }));
            return;
        }

        // Bridge needs us to generate a browser command via LLM
        if (msg.type === 'need_command') {
            const runtimeConfig = getComputerUseRuntimeConfig({ includeSecrets: false });
            const policy = runtimeConfig?.navigationPolicy || { mode: 'free', allowedDomains: [], blockedDomains: [], blockBehavior: 'block' };
            try {
                const raw2 = await callLLM([
                    { role: 'system', content: CMD_PROMPT },
                    { role: 'user', content: `Paso: ${msg.description}\n\nDOM:\n${msg.dom}` },
                ], {
                    runId: msg.runId || null,
                    sessionId: normalizedSessionId,
                }, 'comando via bridge');
                const baseCommand = normalizeBrowserCommand(safeParseLLMJson(raw2), msg.description);
                const command = applyNavigationPolicyToCommand(baseCommand, policy);
                ws.send(JSON.stringify({ type: 'command_response', stepId: msg.stepId, command }));
            } catch (err) {
                const fallback = applyNavigationPolicyToCommand(buildSearchFallback(msg.description), policy);
                ws.send(JSON.stringify({ type: 'command_response', stepId: msg.stepId, command: fallback }));
            }
        }

        // Bridge needs us to evaluate if a step succeeded
        if (msg.type === 'need_eval') {
            try {
                const evaluation = await evaluateStepWithExtraction(
                    msg.description,
                    msg.dom,
                    {
                    runId: msg.runId || null,
                    sessionId: normalizedSessionId,
                    },
                    msg.goal || ''
                );
                ws.send(JSON.stringify({
                    type: 'eval_response',
                    stepId: msg.stepId,
                    ok: Boolean(evaluation.ok),
                    extracted: evaluation.extracted,
                    summary: evaluation.summary || '',
                }));
            } catch {
                ws.send(JSON.stringify({ type: 'eval_response', stepId: msg.stepId, ok: false }));
            }
        }
    });

    ws.on('close', () => {
        bridges.delete(normalizedSessionId);
        console.log(`[Bridge] Disconnected: ${normalizedSessionId}`);
    });
}

export function isBridgeConnected(sessionId) {
    const ws = bridges.get(normalizeSessionId(sessionId));
    return ws?.readyState === 1;
}

export function getConnectedBridges() {
    return [...bridges.keys()].filter(id => isBridgeConnected(id));
}

// ─── Run a task via the bridge, piping events back to SSE ────────────────────
export function runViaBridge(sessionId, goal, steps, res, telemetryBase = {}, options = {}) {
    return new Promise((resolve, reject) => {
        const normalizedSessionId = normalizeSessionId(sessionId);
        const ws = bridges.get(normalizedSessionId);
        if (!ws || !isBridgeConnected(normalizedSessionId)) return reject(new Error('Bridge no conectado'));
        let settled = false;
        const INACTIVITY_TIMEOUT_MS = 180000;
        let timeout = null;
        let cancelWatch = null;
        const isCancelled = typeof options?.isCancelled === 'function' ? options.isCancelled : () => false;
        const cancelReason = typeof options?.cancelReason === 'function' ? options.cancelReason : () => 'Cancelado por usuario';

        const resetTimeout = () => {
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => {
                sseWrite('error', { message: 'Timeout por inactividad del bridge' });
                finalize(new Error('Timeout por inactividad del bridge'));
            }, INACTIVITY_TIMEOUT_MS);
        };

        const finalize = (err) => {
            if (settled) return;
            settled = true;
            if (timeout) clearTimeout(timeout);
            if (cancelWatch) clearInterval(cancelWatch);
            ws.off('message', handler);
            ws.off('close', onClose);
            ws.off('error', onError);
            if (err) reject(err);
            else resolve();
        };

        const sseWrite = (event, data) => {
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        resetTimeout();

        cancelWatch = setInterval(() => {
            if (settled) return;
            if (!isCancelled()) return;

            try {
                ws.send(JSON.stringify({
                    type: 'cancel_run',
                    sessionId: normalizedSessionId,
                    reason: cancelReason(),
                }));
            } catch {
                // ignore bridge send errors during cancellation
            }

            finalize(new Error('__RUN_CANCELLED__'));
        }, 250);

        const handler = (raw) => {
            let msg;
            try { msg = JSON.parse(raw.toString()); } catch { return; }
            if (msg.sessionId && normalizeSessionId(msg.sessionId) !== normalizedSessionId) return;

            // Any valid message from this bridge keeps the run alive.
            resetTimeout();

            switch (msg.type) {
                case 'screenshot': sseWrite('screenshot', { data: msg.data }); break;
                case 'step_start':
                    sseWrite('step_start', { id: msg.stepId, description: msg.description });
                    logAgentAction({
                        ...telemetryBase,
                        sessionId: normalizedSessionId,
                        actionType: 'step_start',
                        stepId: msg.stepId,
                        description: msg.description,
                        status: 'in_progress',
                        modelIdentifier: MODEL,
                        project: TELEMETRY_PROJECT,
                        module: TELEMETRY_MODULE,
                        agentLogicalName: TELEMETRY_AGENT_LOGICAL,
                        agentPublicName: TELEMETRY_AGENT_PUBLIC,
                        platform: TELEMETRY_PLATFORM,
                    });
                    break;
                case 'command':
                    sseWrite('command', { stepId: msg.stepId, command: msg.command });
                    logAgentAction({
                        ...telemetryBase,
                        sessionId: normalizedSessionId,
                        actionType: 'command_generated',
                        stepId: msg.stepId,
                        status: 'ok',
                        payload: { command: msg.command },
                        modelIdentifier: MODEL,
                        project: TELEMETRY_PROJECT,
                        module: TELEMETRY_MODULE,
                        agentLogicalName: TELEMETRY_AGENT_LOGICAL,
                        agentPublicName: TELEMETRY_AGENT_PUBLIC,
                        platform: TELEMETRY_PLATFORM,
                    });
                    break;
                case 'step_done':
                    sseWrite('step_done', { id: msg.stepId, status: msg.ok ? 'completed' : 'failed' });
                    logAgentAction({
                        ...telemetryBase,
                        sessionId: normalizedSessionId,
                        actionType: 'step_done',
                        stepId: msg.stepId,
                        status: msg.ok ? 'completed' : 'failed',
                        modelIdentifier: MODEL,
                        project: TELEMETRY_PROJECT,
                        module: TELEMETRY_MODULE,
                        agentLogicalName: TELEMETRY_AGENT_LOGICAL,
                        agentPublicName: TELEMETRY_AGENT_PUBLIC,
                        platform: TELEMETRY_PLATFORM,
                    });
                    break;
                case 'step_error':
                    sseWrite('step_error', { id: msg.stepId, error: msg.error });
                    logAgentAction({
                        ...telemetryBase,
                        sessionId: normalizedSessionId,
                        actionType: 'step_error',
                        stepId: msg.stepId,
                        status: 'failed',
                        errorMessage: msg.error,
                        modelIdentifier: MODEL,
                        project: TELEMETRY_PROJECT,
                        module: TELEMETRY_MODULE,
                        agentLogicalName: TELEMETRY_AGENT_LOGICAL,
                        agentPublicName: TELEMETRY_AGENT_PUBLIC,
                        platform: TELEMETRY_PLATFORM,
                    });
                    break;
                case 'extracted_data':
                    sseWrite('extracted_data', {
                        stepId: msg.stepId,
                        description: msg.description,
                        summary: msg.summary || '',
                        items: Array.isArray(msg.items) ? msg.items : [],
                    });
                    logAgentAction({
                        ...telemetryBase,
                        sessionId: normalizedSessionId,
                        actionType: 'data_extracted',
                        stepId: msg.stepId,
                        status: 'completed',
                        description: msg.description || null,
                        payload: {
                            summary: msg.summary || '',
                            items: Array.isArray(msg.items) ? msg.items : [],
                        },
                        modelIdentifier: MODEL,
                        project: TELEMETRY_PROJECT,
                        module: TELEMETRY_MODULE,
                        agentLogicalName: TELEMETRY_AGENT_LOGICAL,
                        agentPublicName: TELEMETRY_AGENT_PUBLIC,
                        platform: TELEMETRY_PLATFORM,
                    });
                    break;
                case 'done':
                    sseWrite('done', {
                        success: msg.success,
                        summary: msg.summary,
                        usage: getRunUsage(telemetryBase.runId),
                    });
                    logAgentAction({
                        ...telemetryBase,
                        sessionId: normalizedSessionId,
                        actionType: 'run_completed',
                        status: msg.success ? 'completed' : 'partial',
                        payload: { summary: msg.summary },
                        modelIdentifier: MODEL,
                        project: TELEMETRY_PROJECT,
                        module: TELEMETRY_MODULE,
                        agentLogicalName: TELEMETRY_AGENT_LOGICAL,
                        agentPublicName: TELEMETRY_AGENT_PUBLIC,
                        platform: TELEMETRY_PLATFORM,
                    });
                    finalize();
                    break;
                case 'error':
                    sseWrite('error', { message: msg.message });
                    logAgentAction({
                        ...telemetryBase,
                        sessionId: normalizedSessionId,
                        actionType: 'run_error',
                        status: 'failed',
                        errorMessage: msg.message,
                        modelIdentifier: MODEL,
                        project: TELEMETRY_PROJECT,
                        module: TELEMETRY_MODULE,
                        agentLogicalName: TELEMETRY_AGENT_LOGICAL,
                        agentPublicName: TELEMETRY_AGENT_PUBLIC,
                        platform: TELEMETRY_PLATFORM,
                    });
                    finalize(new Error(msg.message));
                    break;
            }
        };

        const onClose = () => {
            sseWrite('error', { message: 'Bridge desconectado durante la ejecución' });
            logAgentAction({
                ...telemetryBase,
                sessionId: normalizedSessionId,
                actionType: 'bridge_disconnected',
                status: 'failed',
                errorMessage: 'Bridge desconectado durante la ejecución',
                modelIdentifier: MODEL,
                project: TELEMETRY_PROJECT,
                module: TELEMETRY_MODULE,
                agentLogicalName: TELEMETRY_AGENT_LOGICAL,
                agentPublicName: TELEMETRY_AGENT_PUBLIC,
                platform: TELEMETRY_PLATFORM,
            });
            finalize(new Error('Bridge desconectado durante la ejecución'));
        };

        const onError = (err) => {
            sseWrite('error', { message: 'Error de WebSocket bridge' });
            logAgentAction({
                ...telemetryBase,
                sessionId: normalizedSessionId,
                actionType: 'bridge_error',
                status: 'failed',
                errorMessage: err?.message || 'Error de WebSocket bridge',
                modelIdentifier: MODEL,
                project: TELEMETRY_PROJECT,
                module: TELEMETRY_MODULE,
                agentLogicalName: TELEMETRY_AGENT_LOGICAL,
                agentPublicName: TELEMETRY_AGENT_PUBLIC,
                platform: TELEMETRY_PLATFORM,
            });
            finalize(err instanceof Error ? err : new Error('Error de WebSocket bridge'));
        };

        ws.on('message', handler);
        ws.on('close', onClose);
        ws.on('error', onError);
        const runtimeConfig = getComputerUseRuntimeConfig({ includeSecrets: false });
        ws.send(JSON.stringify({
            type: 'run',
            sessionId: normalizedSessionId,
            runId: telemetryBase?.runId || null,
            goal,
            steps,
            restrictions: {
                navigationPolicy: runtimeConfig?.navigationPolicy || { mode: 'free', allowedDomains: [], blockedDomains: [], blockBehavior: 'block' },
            },
        }));
    });
}
