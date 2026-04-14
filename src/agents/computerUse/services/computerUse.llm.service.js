import axios from 'axios';
import { logAgentAction, logModelUsage } from '../../../shared/services/agentTelemetry.service.js';
import { getComputerUseRuntimeConfig } from './computerUse.config.service.js';
import {
    MAX_PARSE_RETRIES,
    LLM_MAX_RETRIES,
    LLM_BASE_DELAY_MS,
    TELEMETRY_PROJECT,
    TELEMETRY_MODULE,
    TELEMETRY_AGENT_LOGICAL,
    TELEMETRY_AGENT_PUBLIC,
    TELEMETRY_PLATFORM,
    PLANNER_PROMPT,
    CMD_PROMPT,
} from './computerUse.constants.js';

const ALLOWED_ACTIONS = new Set(['click', 'type', 'navigate', 'scroll', 'hover', 'select', 'wait', 'go_back']);

// Regex simple: captura la URL hasta el primer espacio o char claramente fuera de URL.
// Se excluyen () [] {} porque el LLM los usa como delimitadores en texto, no como parte de URLs reales.
const URL_REGEX = /https?:\/\/[^\s"'<>()[\]{}]+/i;
const runUsageMap = new Map();

function normalizeRunUsage(raw = {}) {
    return {
        tokensInput: Number(raw.tokensInput || 0),
        tokensOutput: Number(raw.tokensOutput || 0),
        tokensTotal: Number(raw.tokensTotal || 0),
        estimatedCost: Number(raw.estimatedCost || 0),
        llmCalls: Number(raw.llmCalls || 0),
    };
}

function updateRunUsage(runId, patch = {}) {
    const key = String(runId || '').trim();
    if (!key) return;
    const current = normalizeRunUsage(runUsageMap.get(key));
    runUsageMap.set(key, {
        tokensInput: current.tokensInput + Number(patch.tokensInput || 0),
        tokensOutput: current.tokensOutput + Number(patch.tokensOutput || 0),
        tokensTotal: current.tokensTotal + Number(patch.tokensTotal || 0),
        estimatedCost: current.estimatedCost + Number(patch.estimatedCost || 0),
        llmCalls: current.llmCalls + Number(patch.llmCalls || 0),
    });
}

export function initRunUsage(runId) {
    const key = String(runId || '').trim();
    if (!key) return;
    runUsageMap.set(key, normalizeRunUsage());
}

export function getRunUsage(runId) {
    const key = String(runId || '').trim();
    if (!key) return normalizeRunUsage();
    return normalizeRunUsage(runUsageMap.get(key));
}

export function clearRunUsage(runId) {
    const key = String(runId || '').trim();
    if (!key) return;
    runUsageMap.delete(key);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRetryDelayMs(error, attempt) {
    const retryAfter = error?.response?.headers?.['retry-after'];
    const retryAfterSec = Number(retryAfter);
    if (!Number.isNaN(retryAfterSec) && retryAfterSec > 0) {
        return retryAfterSec * 1000;
    }
    return LLM_BASE_DELAY_MS * Math.pow(2, attempt);
}

function isRetryableLlmError(error) {
    const status = error?.response?.status;
    const code = error?.code;
    return status === 429 || status >= 500 || code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ECONNRESET';
}

function buildProviderErrorContext(runtimeConfig = {}, status, upstreamMessage = '') {
    const provider = String(runtimeConfig?.provider || 'unknown');
    const model = String(runtimeConfig?.model || 'unknown');

    if (provider === 'azure-openai') {
        let endpointHost = '';
        try {
            endpointHost = new URL(String(runtimeConfig?.azure?.endpoint || '')).host;
        } catch {
            endpointHost = String(runtimeConfig?.azure?.endpoint || '').trim();
        }

        const deployment = String(runtimeConfig?.azure?.deployment || '').trim();
        const apiVersion = String(runtimeConfig?.azure?.apiVersion || '').trim();

        if (status === 401) {
            return [
                `401 del proveedor IA (Azure OpenAI).`,
                `provider=${provider}, model=${model}, endpointHost=${endpointHost || 'n/a'}, deployment=${deployment || 'n/a'}, apiVersion=${apiVersion || 'n/a'}.`,
                'Revisa que el API key corresponda exactamente al recurso del endpoint configurado y que el deployment exista en ese recurso.',
                upstreamMessage ? `Detalle proveedor: ${upstreamMessage}` : '',
            ].filter(Boolean).join(' ');
        }

        return [
            `Error del proveedor IA (Azure OpenAI), status=${status || 'n/a'}.`,
            `provider=${provider}, model=${model}, endpointHost=${endpointHost || 'n/a'}, deployment=${deployment || 'n/a'}, apiVersion=${apiVersion || 'n/a'}.`,
            upstreamMessage ? `Detalle proveedor: ${upstreamMessage}` : '',
        ].filter(Boolean).join(' ');
    }

    if (provider === 'openrouter') {
        if (status === 401) {
            return [
                `401 del proveedor IA (OpenRouter).`,
                `provider=${provider}, model=${model}.`,
                'Revisa OPENROUTER_API_KEY en el backend desplegado y confirma que no este vacia o expirada.',
                upstreamMessage ? `Detalle proveedor: ${upstreamMessage}` : '',
            ].filter(Boolean).join(' ');
        }

        return [
            `Error del proveedor IA (OpenRouter), status=${status || 'n/a'}.`,
            `provider=${provider}, model=${model}.`,
            upstreamMessage ? `Detalle proveedor: ${upstreamMessage}` : '',
        ].filter(Boolean).join(' ');
    }

    return [
        `Error del proveedor IA, status=${status || 'n/a'}.`,
        `provider=${provider}, model=${model}.`,
        upstreamMessage ? `Detalle proveedor: ${upstreamMessage}` : '',
    ].filter(Boolean).join(' ');
}

export async function callLLM(messages, telemetry = {}, contextDescription = 'planner/comando/evaluacion') {
    let lastError;
    const startedAt = Date.now();
    const runtimeConfig = getComputerUseRuntimeConfig({ includeSecrets: true });
    const modelIdentifier = runtimeConfig.model;

    for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
        try {
            let response;
            if (runtimeConfig.provider === 'azure-openai') {
                const endpoint = runtimeConfig.azure.endpoint.replace(/\/+$/, '');
                const url = `${endpoint}/openai/deployments/${runtimeConfig.azure.deployment}/chat/completions?api-version=${runtimeConfig.azure.apiVersion}`;
                response = await axios.post(
                    url,
                    { messages },
                    {
                        headers: {
                            'api-key': runtimeConfig.azure.apiKey,
                            'Content-Type': 'application/json',
                        },
                        timeout: 30000,
                    }
                );
            } else {
                response = await axios.post(
                    'https://openrouter.ai/api/v1/chat/completions',
                    { model: modelIdentifier, messages },
                    {
                        headers: {
                            'Authorization': `Bearer ${runtimeConfig.openrouter.apiKey}`,
                            'Content-Type': 'application/json',
                        },
                        timeout: 30000,
                    }
                );
            }

            const usage = response.data?.usage || {};
            const llmDurationMs = Date.now() - startedAt;
            const promptTokens = Number(usage.prompt_tokens || 0);
            const completionTokens = Number(usage.completion_tokens || 0);
            const totalTokens = Number(usage.total_tokens || (promptTokens + completionTokens));

            const runtimeConfigForCost = getComputerUseRuntimeConfig({ includeSecrets: true });
            const isAzure = runtimeConfigForCost.provider === 'azure-openai';
            const inputCostPerMillion = isAzure
                ? Number(process.env.AZURE_INPUT_TOKEN_COST_PER_MILLION || 0)
                : 0;
            const outputCostPerMillion = isAzure
                ? Number(process.env.AZURE_OUTPUT_TOKEN_COST_PER_MILLION || 0)
                : 0;
            const estimatedCost = ((promptTokens / 1000000) * inputCostPerMillion) + ((completionTokens / 1000000) * outputCostPerMillion);

            updateRunUsage(telemetry.runId, {
                tokensInput: promptTokens,
                tokensOutput: completionTokens,
                tokensTotal: totalTokens,
                estimatedCost,
                llmCalls: 1,
            });

            await logModelUsage({
                runId: telemetry.runId,
                sessionId: telemetry.sessionId,
                collaboratorId: telemetry.collaboratorId,
                tokensInput: promptTokens,
                tokensOutput: completionTokens,
                tokensTotal: totalTokens,
                timeEjecucionSec: llmDurationMs / 1000,
                modelIdentifier,
                project: TELEMETRY_PROJECT,
                module: TELEMETRY_MODULE,
                agentLogicalName: TELEMETRY_AGENT_LOGICAL,
                agentPublicName: TELEMETRY_AGENT_PUBLIC,
                platform: TELEMETRY_PLATFORM,
            });

            await logAgentAction({
                runId: telemetry.runId,
                sessionId: telemetry.sessionId,
                actionType: 'llm_call',
                status: 'completed',
                description: `Llamada a LLM para ${contextDescription}`,
                tokensInput: promptTokens,
                tokensOutput: completionTokens,
                tokensTotal: totalTokens,
                durationMs: llmDurationMs,
                payload: { model: modelIdentifier },
                modelIdentifier,
                project: TELEMETRY_PROJECT,
                module: TELEMETRY_MODULE,
                agentLogicalName: TELEMETRY_AGENT_LOGICAL,
                agentPublicName: TELEMETRY_AGENT_PUBLIC,
                platform: TELEMETRY_PLATFORM,
            });

            return response.data.choices?.[0]?.message?.content ?? '';
        } catch (error) {
            lastError = error;
            if (!isRetryableLlmError(error) || attempt === LLM_MAX_RETRIES) {
                break;
            }
            const delayMs = getRetryDelayMs(error, attempt);
            await sleep(delayMs);
        }
    }

    const status = lastError?.response?.status;
    const upstreamMessage = String(
        lastError?.response?.data?.error?.message
        || lastError?.response?.data?.message
        || ''
    ).trim();
    if (status === 429) {
        throw new Error('El proveedor de IA devolvio 429 (rate limit). Se reintento automaticamente sin exito.');
    }
    if (status === 401 || status === 403) {
        throw new Error(buildProviderErrorContext(runtimeConfig, status, upstreamMessage));
    }
    throw lastError;
}

export function safeParseLLMJson(raw) {
    const cleaned = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    try {
        return JSON.parse(cleaned);
    } catch {
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match) {
            throw new Error(`No JSON valido: ${String(raw).slice(0, 150)}`);
        }
        return JSON.parse(match[0]);
    }
}

// Chars que el LLM pega al final de una URL cuando ésta aparece entre
// paréntesis, comillas, corchetes o al final de una frase.
const TRAILING_JUNK_RE = /[)\]}'".,;:!?\s]+$/;

function normalizeUrl(url = '') {
    let value = String(url || '').trim();
    if (!value) return '';

    // Reparar protocolos malformados comunes del modelo.
    value = value
        .replace(/^https;\/\//i, 'https://')
        .replace(/^http;\/\//i,  'http://')
        .replace(/^https:\/\/+/i, 'https://')
        .replace(/^http:\/\/+/i,  'http://')
        .replace(/^https:\\+/i,  'https://')
        .replace(/^http:\\+/i,   'http://');

    // Eliminar chars de cierre incrustados antes de una barra: https://host)/ → https://host/
    value = value.replace(/[)\]}'"]+(?=\/)/g, '');

    // Eliminar chars de cierre que el LLM añade al final de la URL.
    value = value.replace(TRAILING_JUNK_RE, '');

    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;
    if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(value)) return `https://${value}`;
    return '';
}

function inferUrlFromText(text = '') {
    const raw = String(text || '').trim();
    if (!raw) return '';
    const direct = raw.match(URL_REGEX)?.[0] || '';
    if (direct) return normalizeUrl(direct);

    // Fallback: detectar dominio sin protocolo, excluyendo chars de cierre.
    const domainLike = raw.match(/[a-z0-9.-]+\.[a-z]{2,}(?::\d{2,5})?(?:\/[^\s"')\]},;:!?]*)?(?:\?[^\s"')\]},;:!?]*)?(?:#[^\s"')\]},;:!?]*)?/i)?.[0]?.replace(TRAILING_JUNK_RE, '') || '';
    if (domainLike) return normalizeUrl(domainLike);
    return '';
}

export function extractFirstUrlFromText(text = '') {
    return inferUrlFromText(text);
}

function shouldUseSearchFallback(text = '') {
    const normalized = String(text || '').toLowerCase();
    if (!normalized) return false;

    const searchHints = [
        'buscar',
        'search',
        'googlea',
        'investigar',
        'documentacion',
        'documentación',
        'solucion para',
        'solución para',
        'how to',
    ];

    const nonSearchHints = [
        'iniciar sesion',
        'iniciar sesión',
        'login',
        'sign in',
        'registrar',
        'formulario',
        'capturar',
        'llenar campo',
    ];

    if (nonSearchHints.some((hint) => normalized.includes(hint))) {
        return false;
    }

    return searchHints.some((hint) => normalized.includes(hint));
}

function sanitizeStepDescription(value = '') {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizePlannedSteps(rawSteps = []) {
    const seen = new Set();
    const normalized = [];

    for (const step of rawSteps) {
        const description = sanitizeStepDescription(step?.description || '');
        if (!description) continue;

        const key = description.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        normalized.push({
            id: String(step?.id || `step${normalized.length + 1}`),
            description,
            status: 'pending',
        });

        if (normalized.length >= 12) break;
    }

    return normalized;
}

export function normalizeProvidedSteps(steps) {
    if (!Array.isArray(steps)) return [];
    return steps
        .map((step, index) => ({
            id: String(step?.id || `step${index + 1}`),
            description: String(step?.description || '').trim(),
            status: 'pending',
            substeps: Array.isArray(step?.substeps)
                ? step.substeps
                    .map((substep, substepIndex) => ({
                        id: String(substep?.id || `step${index + 1}.${substepIndex + 1}`),
                        description: String(substep?.description || '').trim(),
                        status: 'pending',
                    }))
                    .filter(substep => substep.description.length > 0)
                : [],
        }))
        .filter(step => step.description.length > 0);
}

export async function generatePlan(goal, telemetry) {
    for (let attempt = 0; attempt <= MAX_PARSE_RETRIES; attempt++) {
        const raw = await callLLM([
            { role: 'system', content: PLANNER_PROMPT },
            { role: 'user', content: `Objetivo: ${goal}` },
        ], telemetry, 'planner');

        try {
            const data = safeParseLLMJson(raw);
            if (!data.steps?.length) throw new Error('Plan vacio');
            const planned = sanitizePlannedSteps(data.steps);
            if (!planned.length) throw new Error('Plan vacio tras normalizacion');
            return planned;
        } catch (error) {
            if (attempt === MAX_PARSE_RETRIES) {
                throw error;
            }
        }
    }

    return [];
}

function buildSearchFallback(description = '') {
    const explicitUrl = inferUrlFromText(description);
    if (explicitUrl) {
        return { action: 'navigate', url: explicitUrl };
    }

    if (shouldUseSearchFallback(description)) {
        const query = encodeURIComponent(String(description || '').trim());
        return { action: 'navigate', url: `https://www.google.com/search?q=${query}` };
    }

    return { action: 'wait', value: '1200' };
}

export function normalizeBrowserCommand(command, description = '') {
    if (!command || typeof command !== 'object') return buildSearchFallback(description);

    const action = String(command.action || '').trim().toLowerCase();
    if (!ALLOWED_ACTIONS.has(action)) return buildSearchFallback(description);

    const normalized = { action };
    if (command.target != null) normalized.target = String(command.target);
    if (command.text != null) normalized.text = String(command.text);
    if (command.url != null) normalized.url = normalizeUrl(String(command.url));
    if (command.value != null) normalized.value = String(command.value);

    if (action === 'navigate' && !normalized.url) {
        const inferred = inferUrlFromText(description);
        if (inferred) {
            normalized.url = inferred;
            return normalized;
        }
        return buildSearchFallback(description);
    }

    if ((action === 'click' || action === 'type' || action === 'hover' || action === 'select') && !normalized.target) {
        return { action: 'wait', value: '1000' };
    }

    if (action === 'type' && (normalized.text == null || String(normalized.text).trim().length === 0)) {
        return { action: 'wait', value: '800' };
    }

    if (action === 'scroll' && (normalized.value == null || Number.isNaN(parseInt(normalized.value, 10)))) {
        normalized.value = '450';
    }

    if (action === 'wait' && (normalized.value == null || Number.isNaN(parseInt(normalized.value, 10)))) {
        normalized.value = '900';
    }

    return normalized;
}

export async function generateBrowserCommand(description, dom, telemetry) {
    for (let attempt = 0; attempt <= MAX_PARSE_RETRIES; attempt++) {
        const raw = await callLLM([
            { role: 'system', content: CMD_PROMPT },
            { role: 'user', content: `Paso: ${description}\n\nDOM:\n${dom}` },
        ], telemetry, 'comando de navegador');

        try {
            const parsed = safeParseLLMJson(raw);
            return normalizeBrowserCommand(parsed, description);
        } catch (error) {
            if (attempt === MAX_PARSE_RETRIES) {
                throw error;
            }
        }
    }

    return buildSearchFallback(description);
}

export async function evaluateStep(description, dom, telemetry) {
    const evaluation = await evaluateStepWithExtraction(description, dom, telemetry);
    return Boolean(evaluation.ok);
}

function normalizeExtractedItems(items) {
    if (!Array.isArray(items)) return [];
    return items
        .map((item) => ({
            label: String(item?.label || '').trim(),
            value: String(item?.value || '').trim(),
        }))
        .filter((item) => item.label && item.value)
        .slice(0, 30);
}

export async function evaluateStepWithExtraction(description, dom, telemetry, goal = '', history = [], navigationMap = '') {
    const historyBlock = (Array.isArray(history) && history.length > 0) 
        ? `\n\n[Historial de intentos previos fallidos en este paso]\n${JSON.stringify(history)}` 
        : '';
    const navBlock = navigationMap ? `\n\n[Mapa de Navegación]\n${navigationMap}` : '';
        
    const raw = await callLLM([
        {
            role: 'system',
            content: `Evalua si el paso esta completado usando el DOM actual.
Ademas, si el paso u objetivo implican extraer informacion, devuelve los datos detectados.
Responde SOLO JSON valido con formato:
{"ok":true|false,"reason":"texto corto","extracted":[{"label":"campo","value":"valor"}],"summary":"resumen corto"}`,
        },
        { role: 'user', content: `Objetivo: ${goal || 'N/A'}\nPaso: ${description}${historyBlock}${navBlock}\nDOM actual:\n${dom}` },
    ], telemetry, 'evaluacion y extraccion de paso');

    try {
        const parsed = safeParseLLMJson(raw);
        return {
            ok: Boolean(parsed?.ok),
            reason: String(parsed?.reason || '').trim(),
            summary: String(parsed?.summary || '').trim(),
            extracted: normalizeExtractedItems(parsed?.extracted),
        };
    } catch {
        const normalized = String(raw || '').trim().toLowerCase();
        const ok = normalized === 'true' || /\bok\b\s*[:=]?\s*true/.test(normalized);
        return {
            ok,
            reason: '',
            summary: '',
            extracted: [],
        };
    }
}

export async function generateRecoveryTask(stepDescription, failureReason, telemetry = {}) {
    const raw = await callLLM([
        {
            role: 'system',
            content: `Eres un agente de recuperacion de errores para automatizacion web.
Devuelve una micro-tarea concreta para desbloquear el paso actual.
Responde SOLO JSON valido: {"recoveryTask":"texto"}`,
        },
        {
            role: 'user',
            content: `Paso original: ${stepDescription}\nMotivo de obstruccion: ${failureReason}`,
        },
    ], telemetry, 'recuperacion de obstruccion');

    const parsed = safeParseLLMJson(raw);
    const recoveryTask = String(parsed?.recoveryTask || '').trim();
    if (!recoveryTask) {
        throw new Error('No fue posible generar una tarea de recuperacion.');
    }

    return recoveryTask;
}

export async function improveAutomationGoal(goal, telemetry = {}) {
    const raw = await callLLM([
        {
            role: 'system',
            content: `Eres experto en Prompt Engineering para agentes de automatizacion web.
Reescribe el objetivo del usuario para que sea claro, ejecutable y verificable.
Debes incluir, cuando aplique: contexto, criterio de exito, restricciones y formato esperado de salida.
Responde SOLO con JSON valido: {"improvedGoal":"texto final"}`,
        },
        { role: 'user', content: `Objetivo original: ${goal}` },
    ], telemetry, 'mejora de objetivo');

    const parsed = safeParseLLMJson(raw);
    const improvedGoal = String(parsed?.improvedGoal || '').trim();
    if (!improvedGoal) {
        throw new Error('No se pudo mejorar el objetivo con IA.');
    }
    return improvedGoal;
}
