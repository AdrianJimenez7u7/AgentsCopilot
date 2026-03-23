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
async function runHeadless(goal, steps, res, telemetryBase) {
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

    try {
        for (const step of executableSteps) {
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
                    const dom = await extractInteractiveDOM(page);
                    const command = await generateBrowserCommand(step.description, dom, telemetryBase);
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
            await runViaBridge(sessionId, goal, executionSteps, res, telemetryBase);
        } else {
            // Headless fallback
            await runHeadless(goal, steps, res, telemetryBase);
        }
    } catch (err) {
        sendSSE(res, 'error', { message: err.message });
        await logAgentAction({
            ...telemetryBase,
            actionType: 'run_error',
            status: 'failed',
            errorMessage: err.message,
            modelIdentifier: MODEL,
        });
    } finally {
        clearRunUsage(runId);
        res.end();
    }
}
