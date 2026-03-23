import { prisma } from '../prisma/client.js';

const DEFAULT_PROJECT = 'AgentsCopilot';
const DEFAULT_MODULE = 'computerUse';
const warned = new Set();

function warnOnce(key, error) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[AgentTelemetry] ${key}: ${error?.message || error}`);
}

function asJsonString(payload) {
  if (payload == null) return null;
  try {
    return JSON.stringify(payload);
  } catch {
    return null;
  }
}

function parseModel(modelIdentifier = '') {
  const raw = String(modelIdentifier || '').trim();
  if (!raw) {
    return { proveedor: 'unknown', name: 'unknown', version: null };
  }

  const [proveedor, ...nameParts] = raw.split('/');
  if (nameParts.length === 0) {
    return { proveedor: 'custom', name: proveedor, version: null };
  }

  const [nameVersion, ...rest] = nameParts;
  const [name, version] = String(nameVersion || '').split(':');
  const normalizedName = [name, ...rest].filter(Boolean).join('/');

  return {
    proveedor: proveedor || 'unknown',
    name: normalizedName || raw,
    version: version || null,
  };
}

const modelCache = new Map();
const agentCache = new Map();

export async function ensureTelemetryContext({
  modelIdentifier,
  agentLogicalName,
  agentPublicName,
  platform,
}) {
  const modelMeta = parseModel(modelIdentifier);
  const modelKey = `${modelMeta.proveedor}|${modelMeta.name}|${modelMeta.version || ''}`;

  let modelId = modelCache.get(modelKey);
  if (!modelId) {
    try {
      const existing = await prisma.models.findFirst({
        where: {
          name: modelMeta.name,
          version: modelMeta.version,
          proveedor: modelMeta.proveedor,
        },
        select: { id: true },
      });

      if (existing?.id) {
        modelId = existing.id;
      } else {
        const created = await prisma.models.create({
          data: {
            name: modelMeta.name,
            version: modelMeta.version,
            proveedor: modelMeta.proveedor,
            status: 'active',
          },
          select: { id: true },
        });
        modelId = created.id;
      }

      modelCache.set(modelKey, modelId);
    } catch (error) {
      warnOnce('models_table_unavailable', error);
    }
  }

  const normalizedAgentLogicalName = String(agentLogicalName || '').trim() || 'computer_use';
  const agentKey = `${normalizedAgentLogicalName}|${modelId || 'no-model'}`;
  let agentId = agentCache.get(agentKey);

  if (!agentId) {
    try {
      const existingAgent = await prisma.agentes.findFirst({
        where: { nombre_logico: normalizedAgentLogicalName },
        select: { id: true, idModelo: true },
      });

      if (existingAgent?.id) {
        agentId = existingAgent.id;
        if (!existingAgent.idModelo && modelId) {
          await prisma.agentes.update({
            where: { id: existingAgent.id },
            data: { idModelo: modelId },
          });
        }
      } else {
        const createdAgent = await prisma.agentes.create({
          data: {
            nombre_logico: normalizedAgentLogicalName,
            nombre_publico: agentPublicName || normalizedAgentLogicalName,
            plataforma: platform || 'web',
            estatus: 'active',
            idModelo: modelId || null,
          },
          select: { id: true },
        });
        agentId = createdAgent.id;
      }

      agentCache.set(agentKey, agentId);
    } catch (error) {
      warnOnce('agentes_table_unavailable', error);
    }
  }

  return { modelId: modelId || null, agentId: agentId || null };
}

export async function logAgentAction({
  runId,
  sessionId,
  actionType,
  stepId,
  description,
  status,
  tokensInput,
  tokensOutput,
  tokensTotal,
  costAverage,
  durationMs,
  payload,
  errorMessage,
  modelIdentifier,
  agentLogicalName = 'computer_use',
  agentPublicName = 'Computer Use',
  platform = 'web',
  project = DEFAULT_PROJECT,
  module = DEFAULT_MODULE,
}) {
  if (!runId || !actionType) return;

  try {
    const { modelId, agentId } = await ensureTelemetryContext({
      modelIdentifier,
      agentLogicalName,
      agentPublicName,
      platform,
    });

    await prisma.agentActions.create({
      data: {
        runId: String(runId),
        sessionId: sessionId ? String(sessionId) : null,
        agentId,
        modelId,
        project,
        module,
        actionType: String(actionType),
        stepId: stepId ? String(stepId) : null,
        description: description ? String(description) : null,
        status: status ? String(status) : null,
        tokensInput: Number.isFinite(tokensInput) ? Number(tokensInput) : null,
        tokensOutput: Number.isFinite(tokensOutput) ? Number(tokensOutput) : null,
        tokensTotal: Number.isFinite(tokensTotal) ? Number(tokensTotal) : null,
        costAverage: Number.isFinite(costAverage) ? Number(costAverage) : null,
        durationMs: Number.isFinite(durationMs) ? Number(durationMs) : null,
        payloadJson: asJsonString(payload),
        errorMessage: errorMessage ? String(errorMessage) : null,
      },
    });
  } catch (error) {
    warnOnce('agent_actions_table_unavailable', error);
  }
}

export async function logModelUsage({
  runId,
  sessionId,
  collaboratorId,
  tokensInput,
  tokensOutput,
  tokensTotal,
  timeEjecucionSec,
  averageTimeHumaneJecutationSec,
  modelIdentifier,
  agentLogicalName = 'computer_use',
  agentPublicName = 'Computer Use',
  platform = 'web',
  project = DEFAULT_PROJECT,
  module = DEFAULT_MODULE,
}) {
  try {
    const { modelId, agentId } = await ensureTelemetryContext({
      modelIdentifier,
      agentLogicalName,
      agentPublicName,
      platform,
    });

    if (!modelId) return;

    let costAverage = null;
    if (Number.isFinite(tokensInput) || Number.isFinite(tokensOutput)) {
      const model = await prisma.models.findUnique({
        where: { id: modelId },
        select: { inputTokenCostPerMillion: true, outputTokenCostPerMillion: true },
      });

      const inputCost = Number(model?.inputTokenCostPerMillion || 0) * (Number(tokensInput || 0) / 1000000);
      const outputCost = Number(model?.outputTokenCostPerMillion || 0) * (Number(tokensOutput || 0) / 1000000);
      const total = inputCost + outputCost;
      costAverage = Number.isFinite(total) ? total : null;
    }

    await prisma.usesModels.create({
      data: {
        idModel: modelId,
        agentId,
        colaboradorID: collaboratorId ? String(collaboratorId) : null,
        sessionId: sessionId ? String(sessionId) : null,
        runId: runId ? String(runId) : null,
        project,
        module,
        timeEjecucionSec: Number.isFinite(timeEjecucionSec) ? Number(timeEjecucionSec) : null,
        averageTimeHumaneJecutationSec: Number.isFinite(averageTimeHumaneJecutationSec)
          ? Number(averageTimeHumaneJecutationSec)
          : null,
        tokensInput: Number.isFinite(tokensInput) ? Number(tokensInput) : null,
        tokensOutput: Number.isFinite(tokensOutput) ? Number(tokensOutput) : null,
        tokensTotal: Number.isFinite(tokensTotal) ? Number(tokensTotal) : null,
        costAverage,
      },
    });
  } catch (error) {
    warnOnce('uses_models_table_unavailable', error);
  }
}
