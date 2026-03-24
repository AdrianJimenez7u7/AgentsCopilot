import { runComputerUseAgent, cancelComputerUseRun } from '../computerUse.service.js';
import { isBridgeConnected, getConnectedBridges } from '../computerUseBridge.service.js';
import { improveAutomationGoal } from '../services/computerUse.llm.service.js';
import { prisma } from '../../../shared/prisma/client.js';
import {
    listAvailableComputerUseModels,
    getComputerUseRuntimeConfig,
    updateComputerUseRuntimeConfig,
} from '../services/computerUse.config.service.js';

export async function runComputerUse(req, res) {
    const { goal, sessionId, steps, requirePlanConfirmation } = req.body;
    const normalizedGoal = String(goal || '').trim();

    if (!normalizedGoal) {
        return res.status(400).json({ error: '"goal" es requerido' });
    }

    await runComputerUseAgent(normalizedGoal, sessionId ?? null, res, {
        steps: Array.isArray(steps) ? steps : null,
        requirePlanConfirmation: Boolean(requirePlanConfirmation),
    });
}

export function cancelComputerUse(req, res) {
    const runId = String(req.body?.runId || '').trim() || null;
    const sessionId = String(req.body?.sessionId || '').trim() || null;
    const reason = String(req.body?.reason || '').trim() || 'Cancelado por usuario';

    if (!runId && !sessionId) {
        return res.status(400).json({ ok: false, error: 'Se requiere runId o sessionId para cancelar.' });
    }

    const result = cancelComputerUseRun({ runId, sessionId, reason });
    if (!result.cancelled) {
        return res.status(404).json({ ok: false, error: result.message || 'No hay corrida activa para cancelar.' });
    }

    return res.json({ ok: true, ...result });
}

export function getBridgeStatus(req, res) {
    const rawSession = Array.isArray(req.query.sessionId) ? req.query.sessionId[0] : req.query.sessionId;
    const requestedSessionId = String(rawSession ?? '').trim();
    const sessions = getConnectedBridges();

    if (requestedSessionId) {
        return res.json({
            connected: isBridgeConnected(requestedSessionId),
            requestedSessionId,
            sessions,
        });
    }

    return res.json({ connected: sessions.length > 0, sessions });
}

export async function improveGoal(req, res) {
    const goal = String(req.body?.goal || '').trim();
    if (!goal) {
        return res.status(400).json({ error: '"goal" es requerido' });
    }

    try {
        const improvedGoal = await improveAutomationGoal(goal, {
            sessionId: String(req.body?.sessionId || '').trim() || null,
        });
        return res.json({ improvedGoal });
    } catch (error) {
        return res.status(500).json({
            error: error?.message || 'No fue posible mejorar el objetivo',
        });
    }
}

export function getComputerUseModels(req, res) {
    return res.json({ models: listAvailableComputerUseModels() });
}

export function getComputerUseConfig(req, res) {
    return res.json({ config: getComputerUseRuntimeConfig() });
}

export function updateComputerUseConfig(req, res) {
    try {
        const config = updateComputerUseRuntimeConfig(req.body || {});
        return res.json({ ok: true, config });
    } catch (error) {
        return res.status(400).json({ ok: false, error: error?.message || 'No se pudo actualizar la configuracion.' });
    }
}

function parsePayloadJson(payloadJson) {
    if (!payloadJson || typeof payloadJson !== 'string') return null;
    try {
        return JSON.parse(payloadJson);
    } catch {
        return null;
    }
}

export async function getComputerUseUsageSummary(req, res) {
    try {
        const rows = await prisma.usesModels.findMany({
            where: {
                project: 'AgentsCopilot',
                module: 'computerUse',
            },
            include: {
                model: {
                    select: {
                        id: true,
                        proveedor: true,
                        name: true,
                        version: true,
                        inputTokenCostPerMillion: true,
                        outputTokenCostPerMillion: true,
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            take: 1000,
        });

        const acc = new Map();
        for (const row of rows) {
            const modelLabel = row?.model
                ? `${row.model.proveedor}/${row.model.name}${row.model.version ? `:${row.model.version}` : ''}`
                : 'unknown';

            const current = acc.get(modelLabel) || {
                model: modelLabel,
                tokensInput: 0,
                tokensOutput: 0,
                tokensTotal: 0,
                estimatedCost: 0,
                calls: 0,
            };

            const inputTokens = Number(row.tokensInput || 0);
            const outputTokens = Number(row.tokensOutput || 0);
            const reportedCost = Number(row.costAverage || 0);

            const computedInputCost = Number(row?.model?.inputTokenCostPerMillion || 0) * (inputTokens / 1000000);
            const computedOutputCost = Number(row?.model?.outputTokenCostPerMillion || 0) * (outputTokens / 1000000);
            const computedCost = computedInputCost + computedOutputCost;
            const effectiveCost = reportedCost > 0 ? reportedCost : computedCost;

            current.tokensInput += Number(row.tokensInput || 0);
            current.tokensOutput += Number(row.tokensOutput || 0);
            current.tokensTotal += Number(row.tokensTotal || 0);
            current.estimatedCost += Number.isFinite(effectiveCost) ? effectiveCost : 0;
            current.calls += 1;
            acc.set(modelLabel, current);
        }

        const models = Array.from(acc.values())
            .sort((a, b) => b.tokensTotal - a.tokensTotal)
            .map(item => ({
                ...item,
                estimatedCost: Number(item.estimatedCost.toFixed(6)),
            }));

        const totals = models.reduce((agg, model) => {
            agg.tokensInput += model.tokensInput;
            agg.tokensOutput += model.tokensOutput;
            agg.tokensTotal += model.tokensTotal;
            agg.estimatedCost += model.estimatedCost;
            agg.calls += model.calls;
            return agg;
        }, {
            tokensInput: 0,
            tokensOutput: 0,
            tokensTotal: 0,
            estimatedCost: 0,
            calls: 0,
        });

        return res.json({
            models,
            totals: {
                ...totals,
                estimatedCost: Number(totals.estimatedCost.toFixed(6)),
            },
        });
    } catch {
        // Do not block UI when telemetry tables are unavailable.
        return res.json({
            models: [],
            totals: {
                tokensInput: 0,
                tokensOutput: 0,
                tokensTotal: 0,
                estimatedCost: 0,
                calls: 0,
            },
        });
    }
}

export async function getComputerUseActionNotes(req, res) {
    try {
        const rawSession = Array.isArray(req.query.sessionId) ? req.query.sessionId[0] : req.query.sessionId;
        const rawRun = Array.isArray(req.query.runId) ? req.query.runId[0] : req.query.runId;
        const rawTake = Array.isArray(req.query.take) ? req.query.take[0] : req.query.take;

        const sessionId = String(rawSession || '').trim();
        const runId = String(rawRun || '').trim();
        const take = Math.max(1, Math.min(300, Number(rawTake || 120)));

        const where = {
            project: 'AgentsCopilot',
            module: 'computerUse',
            ...(sessionId ? { sessionId } : {}),
            ...(runId ? { runId } : {}),
        };

        const rows = await prisma.agentActions.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take,
            select: {
                id: true,
                runId: true,
                sessionId: true,
                actionType: true,
                stepId: true,
                description: true,
                status: true,
                errorMessage: true,
                payloadJson: true,
                createdAt: true,
            },
        });

        const notes = rows
            .map((row) => {
                const payload = parsePayloadJson(row.payloadJson);
                const explicitNote = String(payload?.note || payload?.notes || '').trim();
                const summary = String(payload?.summary || '').trim();
                const commandAction = String(payload?.command?.action || '').trim();
                const note = explicitNote
                    || row.description
                    || summary
                    || (commandAction ? `Comando sugerido: ${commandAction}` : '')
                    || row.errorMessage
                    || '';

                if (!note) return null;

                return {
                    id: String(row.id),
                    runId: row.runId,
                    sessionId: row.sessionId,
                    actionType: row.actionType,
                    stepId: row.stepId,
                    status: row.status,
                    note,
                    createdAt: row.createdAt,
                };
            })
            .filter(Boolean)
            .reverse();

        return res.json({
            notes,
            count: notes.length,
        });
    } catch {
        return res.json({ notes: [], count: 0 });
    }
}
