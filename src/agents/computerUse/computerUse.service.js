import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { isBridgeConnected, runViaBridge } from './computerUseBridge.service.js';
import { logAgentAction } from '../../shared/services/agentTelemetry.service.js';
import {
    MODEL,
    MAX_ATTEMPTS,
    TELEMETRY_PROJECT,
    TELEMETRY_MODULE,
    TELEMETRY_AGENT_LOGICAL,
    TELEMETRY_AGENT_PUBLIC,
    TELEMETRY_PLATFORM,
} from './services/computerUse.constants.js';
import {
    generatePlan,
    generateBrowserCommand,
    evaluateStep,
    evaluateStepWithExtraction,
    normalizeProvidedSteps,
    generateRecoveryTask,
    extractFirstUrlFromText,
    initRunUsage,
    getRunUsage,
    clearRunUsage,
} from './services/computerUse.llm.service.js';
import { initSSE, sendSSE, sendScreenshot } from './services/computerUse.sse.service.js';
import { getComputerUseRuntimeConfig, isNavigationAllowedByPolicy } from './services/computerUse.config.service.js';

const activeRuns = new Map(); // runId -> { runId, sessionId, cancelled, reason }
const activeRunBySession = new Map(); // sessionId -> runId

const RUN_CANCELLED_CODE = '__RUN_CANCELLED__';

class RunCancelledError extends Error {
    constructor(message = 'Ejecucion cancelada por usuario') {
        super(message);
        this.name = 'RunCancelledError';
        this.code = RUN_CANCELLED_CODE;
    }
}

function isRunCancelledError(error) {
    return error?.code === RUN_CANCELLED_CODE || error?.message === RUN_CANCELLED_CODE;
}

function registerActiveRun(runId, sessionId) {
    const normalizedSessionId = String(sessionId || '').trim() || null;

    const runState = {
        runId,
        sessionId: normalizedSessionId,
        cancelled: false,
        reason: '',
        startedAt: Date.now(),
    };

    activeRuns.set(runId, runState);
    if (normalizedSessionId) {
        activeRunBySession.set(normalizedSessionId, runId);
    }

    return runState;
}

function unregisterActiveRun(runId) {
    const state = activeRuns.get(runId);
    if (!state) return;

    if (state.sessionId && activeRunBySession.get(state.sessionId) === runId) {
        activeRunBySession.delete(state.sessionId);
    }

    activeRuns.delete(runId);
}

function getRunStateByTarget({ runId, sessionId }) {
    const normalizedRunId = String(runId || '').trim();
    if (normalizedRunId && activeRuns.has(normalizedRunId)) {
        return activeRuns.get(normalizedRunId);
    }

    const normalizedSessionId = String(sessionId || '').trim();
    if (normalizedSessionId) {
        const foundRunId = activeRunBySession.get(normalizedSessionId);
        if (foundRunId && activeRuns.has(foundRunId)) {
            return activeRuns.get(foundRunId);
        }
    }

    return null;
}

function assertRunNotCancelled(runState) {
    if (runState?.cancelled) {
        throw new RunCancelledError(runState.reason || 'Ejecucion cancelada por usuario');
    }
}

export function cancelComputerUseRun({ runId, sessionId, reason = '' } = {}) {
    const state = getRunStateByTarget({ runId, sessionId });
    if (!state) {
        return { cancelled: false, message: 'No hay corrida activa para cancelar.' };
    }

    state.cancelled = true;
    state.reason = String(reason || 'Cancelado por usuario').trim() || 'Cancelado por usuario';

    return {
        cancelled: true,
        runId: state.runId,
        sessionId: state.sessionId,
        message: state.reason,
    };
}


// ────────────────────────────────────────────────────────────────────────────
// DOM EXTRACTION
// ────────────────────────────────────────────────────────────────────────────
async function extractInteractiveDOM(page) {
    return page.evaluate(() => {
        const selectors = ['a', 'button', 'input', 'select', 'textarea', "[role='button']", "[role='link']", "[role='textbox']", '[onclick]', '[tabindex]', 'label'];
        const results = [];
        document.querySelectorAll(selectors.join(', ')).forEach(el => {
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

async function executeBrowserCommand(page, command) {
    switch (command.action) {
        case 'navigate': if (command.url) await page.goto(command.url, { waitUntil: 'domcontentloaded' }); break;
        case 'type': if (command.target) await page.fill(command.target, command.text ?? ''); break;
        case 'click': if (command.target) await page.click(command.target); break;
        case 'scroll': await page.evaluate(d => window.scrollBy(0, d), parseInt(command.value ?? '500')); break;
        case 'hover': if (command.target) await page.hover(command.target); break;
        case 'select': if (command.target) await page.selectOption(command.target, command.value ?? ''); break;
        case 'wait': await page.waitForTimeout(parseInt(command.value ?? '1000')); break;
        case 'go_back': await page.goBack(); break;
    }
}

function applyNavigationPolicyToCommand(command = {}, navigationPolicy = {}) {
    if (!command || command.action !== 'navigate') return command;

    const validation = isNavigationAllowedByPolicy(command.url, navigationPolicy);
    if (validation.allowed) return command;

    if (String(navigationPolicy?.blockBehavior || 'block') === 'skip') {
        return {
            action: 'wait',
            value: '700',
            note: `Navegacion omitida por politica: ${validation.reason}`,
        };
    }

    throw new Error(`Navegacion bloqueada por politica: ${validation.reason}`);
}

function getCommandSettleDelayMs(command) {
    const action = String(command?.action || '');
    if (action === 'navigate' || action === 'go_back') return 850;
    if (action === 'wait') return Math.max(300, parseInt(command?.value ?? '1000'));
    if (action === 'scroll') return 300;
    return 550;
}

async function waitAfterCommand(page, command) {
    await page.waitForTimeout(getCommandSettleDelayMs(command));
}

async function tryRecoveryTask(page, step, reason, attempt, res, telemetryBase) {
    try {
        const recoveryTask = await generateRecoveryTask(step.description, reason, telemetryBase);
        sendSSE(res, 'step_recovery', {
            id: step.id,
            attempt,
            recoveryTask,
        });

        await logAgentAction({
            ...telemetryBase,
            actionType: 'step_recovery_generated',
            stepId: step.id,
            description: step.description,
            status: 'info',
            payload: { attempt, recoveryTask, reason },
            modelIdentifier: MODEL,
        });

        const dom = await extractInteractiveDOM(page);
        const recoveryCommand = await generateBrowserCommand(recoveryTask, dom, telemetryBase);
        sendSSE(res, 'command', { stepId: step.id, command: recoveryCommand, recovery: true });

        await logAgentAction({
            ...telemetryBase,
            actionType: 'step_recovery_command',
            stepId: step.id,
            description: recoveryTask,
            status: 'ok',
            payload: { attempt, recoveryCommand },
            modelIdentifier: MODEL,
        });

        await executeBrowserCommand(page, recoveryCommand);
        await waitAfterCommand(page, recoveryCommand);
        await sendScreenshot(res, page);
    } catch (recoveryErr) {
        sendSSE(res, 'step_recovery_error', {
            id: step.id,
            attempt,
            error: recoveryErr?.message || 'Error de recuperacion',
        });
        await logAgentAction({
            ...telemetryBase,
            actionType: 'step_recovery_error',
            stepId: step.id,
            description: step.description,
            status: 'failed',
            payload: { attempt, reason },
            errorMessage: recoveryErr?.message || 'Error de recuperacion',
            modelIdentifier: MODEL,
        });
    }
}

function collectExecutableSteps(steps) {
    const executable = [];

    for (const step of steps) {
        const nested = Array.isArray(step?.substeps) ? step.substeps : [];
        if (nested.length > 0) {
            nested.forEach((substep, substepIndex) => {
                const id = String(substep?.id || `${step.id}.${substepIndex + 1}`);
                const description = String(substep?.description || '').trim();
                if (!description) return;
                executable.push({ id, description, parentId: step.id });
            });
            continue;
        }

        const description = String(step?.description || '').trim();
        if (!description) continue;
        executable.push({ id: step.id, description, parentId: null });
    }

    return executable;
}

function ensureGoalUrlAsInitialStep(steps, goal) {
    const explicitUrl = extractFirstUrlFromText(goal);
    if (!explicitUrl) return steps;

    const hasExplicitNavigation = steps.some((step) => {
        const text = String(step?.description || '').toLowerCase();
        return text.includes(explicitUrl.toLowerCase());
    });

    if (hasExplicitNavigation) return steps;

    return [
        {
            id: 'step_url_entry',
            description: `Abrir navegador y navegar a la URL ${explicitUrl}`,
            status: 'pending',
        },
        ...steps,
    ];
}

function applyExecutionStatusesToHierarchy(steps, executionStatusMap) {
    return steps.map((step) => {
        const nested = Array.isArray(step?.substeps) ? step.substeps : [];

        if (nested.length > 0) {
            const updatedSubsteps = nested.map((substep, substepIndex) => {
                const key = String(substep?.id || `${step.id}.${substepIndex + 1}`);
                const status = executionStatusMap.get(key) || 'pending';
                return { ...substep, status };
            });

            const statuses = updatedSubsteps.map((substep) => substep.status);
            let parentStatus = 'pending';
            if (statuses.length > 0 && statuses.every((status) => status === 'completed')) {
                parentStatus = 'completed';
            } else if (statuses.some((status) => status === 'failed')) {
                parentStatus = 'failed';
            } else if (statuses.some((status) => status === 'in_progress')) {
                parentStatus = 'in_progress';
            }

            return {
                ...step,
                status: parentStatus,
                substeps: updatedSubsteps,
            };
        }

        return {
            ...step,
            status: executionStatusMap.get(step.id) || step.status || 'pending',
        };
    });
}

// ────────────────────────────────────────────────────────────────────────────
// HEADLESS FALLBACK (runs on App Service server)
// ────────────────────────────────────────────────────────────────────────────
async function runHeadless(goal, steps, res, telemetryBase, runState) {
    sendSSE(res, 'status', { message: 'No hay bridge conectado. Usando browser headless en servidor...', phase: 'connecting' });
    await logAgentAction({
        ...telemetryBase,
        actionType: 'route_selected',
        status: 'info',
        description: 'Ejecución en headless por bridge no disponible',
        payload: { route: 'headless' },
        modelIdentifier: MODEL,
    });

    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    sendSSE(res, 'status', { message: '✅ Browser listo (modo servidor)', phase: 'executing' });
    await sendScreenshot(res, page);

    const executableSteps = collectExecutableSteps(steps);
    const executionStatusMap = new Map();
    const runtimeConfig = getComputerUseRuntimeConfig({ includeSecrets: false });
    const navigationPolicy = runtimeConfig?.navigationPolicy || { mode: 'free', allowedDomains: [], blockedDomains: [], blockBehavior: 'block' };

    try {
        for (const step of executableSteps) {
            assertRunNotCancelled(runState);
            sendSSE(res, 'step_start', { id: step.id, description: step.description });
            executionStatusMap.set(step.id, 'in_progress');
            let succeeded = false;
            await logAgentAction({
                ...telemetryBase,
                actionType: 'step_start',
                stepId: step.id,
                description: step.description,
                status: 'in_progress',
                modelIdentifier: MODEL,
            });

            for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
                try {
                    assertRunNotCancelled(runState);
                    const dom = await extractInteractiveDOM(page);
                    const generatedCommand = await generateBrowserCommand(step.description, dom, telemetryBase);
                    const command = applyNavigationPolicyToCommand(generatedCommand, navigationPolicy);
                    sendSSE(res, 'command', { stepId: step.id, command });
                    await logAgentAction({
                        ...telemetryBase,
                        actionType: 'command_generated',
                        stepId: step.id,
                        description: step.description,
                        status: 'ok',
                        payload: { command },
                        modelIdentifier: MODEL,
                    });
                    await executeBrowserCommand(page, command);
                    assertRunNotCancelled(runState);
                    await waitAfterCommand(page, command);
                    await sendScreenshot(res, page);
                    const domAfter = await extractInteractiveDOM(page);
                    const evaluation = await evaluateStepWithExtraction(step.description, domAfter, telemetryBase, goal);

                    if (Array.isArray(evaluation?.extracted) && evaluation.extracted.length > 0) {
                        sendSSE(res, 'extracted_data', {
                            stepId: step.id,
                            description: step.description,
                            summary: evaluation.summary || '',
                            items: evaluation.extracted,
                        });

                        await logAgentAction({
                            ...telemetryBase,
                            actionType: 'data_extracted',
                            stepId: step.id,
                            description: step.description,
                            status: 'completed',
                            payload: {
                                summary: evaluation.summary || '',
                                items: evaluation.extracted,
                            },
                            modelIdentifier: MODEL,
                        });
                    }

                    if (evaluation.ok) {
                        succeeded = true;
                        sendSSE(res, 'step_done', { id: step.id, status: 'completed' });
                        await logAgentAction({
                            ...telemetryBase,
                            actionType: 'step_done',
                            stepId: step.id,
                            description: step.description,
                            status: 'completed',
                            modelIdentifier: MODEL,
                        });
                        break;
                    }

                    if (attempt < MAX_ATTEMPTS - 1) {
                        await tryRecoveryTask(
                            page,
                            step,
                            'El paso no se valido como completado despues del comando principal',
                            attempt + 1,
                            res,
                            telemetryBase,
                        );
                    }

                    sendSSE(res, 'step_retry', { id: step.id, attempt: attempt + 1 });
                    await logAgentAction({
                        ...telemetryBase,
                        actionType: 'step_retry',
                        stepId: step.id,
                        description: step.description,
                        status: 'retry',
                        payload: { attempt: attempt + 1 },
                        modelIdentifier: MODEL,
                    });
                } catch (err) {
                    if (isRunCancelledError(err)) {
                        throw err;
                    }
                    sendSSE(res, 'step_error', { id: step.id, attempt: attempt + 1, error: err.message });
                    await logAgentAction({
                        ...telemetryBase,
                        actionType: 'step_error',
                        stepId: step.id,
                        description: step.description,
                        status: 'failed',
                        payload: { attempt: attempt + 1 },
                        errorMessage: err.message,
                        modelIdentifier: MODEL,
                    });

                    if (attempt < MAX_ATTEMPTS - 1) {
                        assertRunNotCancelled(runState);
                        await tryRecoveryTask(
                            page,
                            step,
                            err.message || 'Error durante la ejecucion del paso',
                            attempt + 1,
                            res,
                            telemetryBase,
                        );
                    }
                }
            }
            if (!succeeded) {
                executionStatusMap.set(step.id, 'failed');
                sendSSE(res, 'step_done', { id: step.id, status: 'failed' });
                await logAgentAction({
                    ...telemetryBase,
                    actionType: 'step_done',
                    stepId: step.id,
                    description: step.description,
                    status: 'failed',
                    modelIdentifier: MODEL,
                });
            } else {
                executionStatusMap.set(step.id, 'completed');
            }
        }
    } finally {
        await browser.close().catch(() => { });
    }

    const hierarchyWithStatus = applyExecutionStatusesToHierarchy(steps, executionStatusMap);
    const allOk = hierarchyWithStatus.every((step) => {
        if (Array.isArray(step.substeps) && step.substeps.length > 0) {
            return step.substeps.every((substep) => substep.status === 'completed');
        }
        return step.status === 'completed';
    });
    await sendScreenshot(res, page).catch(() => { });
    sendSSE(res, 'done', {
        success: allOk,
        usage: getRunUsage(telemetryBase.runId),
        summary: hierarchyWithStatus.map((step) => ({
            id: step.id,
            description: step.description,
            status: step.status,
            substeps: Array.isArray(step.substeps)
                ? step.substeps.map((substep) => ({ id: substep.id, description: substep.description, status: substep.status }))
                : [],
        })),
    });
    await logAgentAction({
        ...telemetryBase,
        actionType: 'run_completed',
        status: allOk ? 'completed' : 'partial',
        payload: {
            success: allOk,
            summary: hierarchyWithStatus.map((step) => ({
                id: step.id,
                status: step.status,
                substeps: Array.isArray(step.substeps)
                    ? step.substeps.map((substep) => ({ id: substep.id, status: substep.status }))
                    : [],
            })),
        },
        modelIdentifier: MODEL,
    });
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ────────────────────────────────────────────────────────────────────────────
export async function runComputerUseAgent(goal, sessionId, res, options = {}) {
    initSSE(res);

    const runId = randomUUID();
    const telemetryBase = {
        runId,
        sessionId: sessionId ? String(sessionId) : null,
        project: TELEMETRY_PROJECT,
        module: TELEMETRY_MODULE,
        agentLogicalName: TELEMETRY_AGENT_LOGICAL,
        agentPublicName: TELEMETRY_AGENT_PUBLIC,
        platform: TELEMETRY_PLATFORM,
    };
    const runState = registerActiveRun(runId, telemetryBase.sessionId);
    initRunUsage(runId);
    const requirePlanConfirmation = Boolean(options?.requirePlanConfirmation);
    const providedSteps = normalizeProvidedSteps(options?.steps);

    try {
        await logAgentAction({
            ...telemetryBase,
            actionType: 'run_started',
            status: 'started',
            description: goal,
            payload: { bridgeRequested: Boolean(sessionId) },
            modelIdentifier: MODEL,
        });
        sendSSE(res, 'status', { message: 'Generando plan...', phase: 'planning' });
        await logAgentAction({
            ...telemetryBase,
            actionType: 'planning_started',
            status: 'in_progress',
            description: 'Generando plan para objetivo',
            modelIdentifier: MODEL,
        });

        const plannedSteps = providedSteps.length > 0 ? providedSteps : await generatePlan(goal, telemetryBase);
        const steps = ensureGoalUrlAsInitialStep(plannedSteps, goal);

        await logAgentAction({
            ...telemetryBase,
            actionType: 'planning_done',
            status: 'completed',
            payload: { steps: steps.map(s => ({ id: s.id, description: s.description })) },
            modelIdentifier: MODEL,
        });

        sendSSE(res, 'plan', { steps });

        if (requirePlanConfirmation && providedSteps.length === 0) {
            sendSSE(res, 'awaiting_confirmation', {
                message: 'Plan generado. Confirma o edita los pasos para continuar.',
                phase: 'plan_review',
            });
            await logAgentAction({
                ...telemetryBase,
                actionType: 'plan_confirmation_requested',
                status: 'pending',
                payload: { steps: steps.map(s => ({ id: s.id, description: s.description })) },
                modelIdentifier: MODEL,
            });
            return;
        }

        await logAgentAction({
            ...telemetryBase,
            actionType: 'plan_confirmed',
            status: 'completed',
            payload: { source: providedSteps.length > 0 ? 'user_edited' : 'auto' },
            modelIdentifier: MODEL,
        });

        if (sessionId && isBridgeConnected(sessionId)) {
            // Route through the user's local bridge
            sendSSE(res, 'status', { message: '✅ Bridge del usuario conectado. Usando tu browser...', phase: 'connecting' });
            await logAgentAction({
                ...telemetryBase,
                actionType: 'route_selected',
                status: 'info',
                description: 'Ejecución en bridge del usuario',
                payload: { route: 'bridge' },
                modelIdentifier: MODEL,
            });
            const executionSteps = collectExecutableSteps(steps).map((step) => ({ id: step.id, description: step.description, status: 'pending' }));
            await runViaBridge(sessionId, goal, executionSteps, res, telemetryBase, {
                isCancelled: () => Boolean(runState.cancelled),
                cancelReason: () => runState.reason || 'Cancelado por usuario',
            });
        } else {
            // Headless fallback
            await runHeadless(goal, steps, res, telemetryBase, runState);
        }
    } catch (err) {
        if (isRunCancelledError(err)) {
            sendSSE(res, 'done', {
                success: false,
                cancelled: true,
                message: runState.reason || 'Ejecucion cancelada por usuario',
                usage: getRunUsage(telemetryBase.runId),
                summary: [],
            });

            await logAgentAction({
                ...telemetryBase,
                actionType: 'run_cancelled',
                status: 'cancelled',
                description: runState.reason || 'Ejecucion cancelada por usuario',
                payload: {
                    cancelled: true,
                    reason: runState.reason || 'Cancelado por usuario',
                },
                modelIdentifier: MODEL,
            });
        } else {
            sendSSE(res, 'error', { message: err.message });
            await logAgentAction({
                ...telemetryBase,
                actionType: 'run_error',
                status: 'failed',
                errorMessage: err.message,
                modelIdentifier: MODEL,
            });
        }
    } finally {
        unregisterActiveRun(runId);
        clearRunUsage(runId);
        res.end();
    }
}
