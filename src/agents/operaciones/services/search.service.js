import { tavily } from '@tavily/core';
import { randomUUID } from 'crypto';
import { logAgentAction } from '../../../shared/services/agentTelemetry.service.js';
const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });

const TELEMETRY_PROJECT = 'AgentsCopilot';
const TELEMETRY_MODULE = 'operaciones';
const TELEMETRY_AGENT_LOGICAL = 'operaciones';
const TELEMETRY_AGENT_PUBLIC = 'Operaciones';
const TELEMETRY_PLATFORM = 'backend';

export class SearchService {

    static async search(sku, retries = 2, telemetry = {}) {
        // Exact SKU match + technical specs in Spanish for better results
        const query = `"${sku}" ficha técnica especificaciones peso dimensiones marca descripción`;
        const runId = telemetry.runId || randomUUID();
        const startedAt = Date.now();

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const response = await tvly.search(query, {
                    searchDepth: "advanced",
                    maxResults: 3,
                    includeImages: false,
                    includeRawContent: false,
                });

                await logAgentAction({
                    runId,
                    sessionId: telemetry.sessionId || null,
                    actionType: 'search_call',
                    status: 'completed',
                    stepId: `search:${sku}`,
                    description: `Búsqueda Tavily para SKU ${sku}`,
                    durationMs: Date.now() - startedAt,
                    payload: {
                        sku,
                        provider: 'tavily',
                        attempt: attempt + 1,
                        resultsCount: Array.isArray(response?.results) ? response.results.length : null,
                    },
                    modelIdentifier: 'search/tavily',
                    collaboratorId: telemetry.collaboratorId || null,
                    project: TELEMETRY_PROJECT,
                    module: TELEMETRY_MODULE,
                    agentLogicalName: TELEMETRY_AGENT_LOGICAL,
                    agentPublicName: TELEMETRY_AGENT_PUBLIC,
                    platform: TELEMETRY_PLATFORM,
                });

                return response;
            } catch (error) {
                if (attempt < retries) {
                    const wait = 1000 * Math.pow(2, attempt); // 1s, 2s
                    console.warn(`Tavily retry ${attempt + 1} for SKU ${sku} in ${wait}ms`);
                    await new Promise(r => setTimeout(r, wait));
                } else {
                    await logAgentAction({
                        runId,
                        sessionId: telemetry.sessionId || null,
                        actionType: 'search_call',
                        status: 'failed',
                        stepId: `search:${sku}`,
                        description: `Búsqueda Tavily fallida para SKU ${sku}`,
                        durationMs: Date.now() - startedAt,
                        errorMessage: error?.message || String(error),
                        payload: {
                            sku,
                            provider: 'tavily',
                            attempts: retries + 1,
                        },
                        modelIdentifier: 'search/tavily',
                        collaboratorId: telemetry.collaboratorId || null,
                        project: TELEMETRY_PROJECT,
                        module: TELEMETRY_MODULE,
                        agentLogicalName: TELEMETRY_AGENT_LOGICAL,
                        agentPublicName: TELEMETRY_AGENT_PUBLIC,
                        platform: TELEMETRY_PLATFORM,
                    });

                    console.error(`Tavily failed for SKU ${sku} after ${retries + 1} attempts:`, error.message);
                    return null;
                }
            }
        }
    }
}