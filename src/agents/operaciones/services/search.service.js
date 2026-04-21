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

    static NON_TECH_KEYWORDS = [
        'moto', 'motocicleta', 'automovil', 'coche', 'llanta', 'paraguas', 'sombrilla',
        'zapato', 'camisa', 'pantalon', 'reloj', 'perfume', 'comida', 'bebida', 'juguete',
        'bicicleta', 'casco', 'mochila escolar', 'ropa', 'bolso'
    ];

    static queryVariants(sku) {
        return [
            `"${sku}" ficha técnica especificaciones peso dimensiones marca descripción producto de tecnología`,
            `"${sku}" datasheet technical specifications manufacturer technology product`,
            `"${sku}" site:hp.com OR site:dell.com OR site:lenovo.com OR site:cdw.com OR site:amazon.com.mx tecnología`
        ];
    }

    static assessSearchQuality(response, sku) {
        const results = Array.isArray(response?.results) ? response.results : [];
        if (results.length === 0) {
            return { isValid: false, reason: 'empty_results', nonTechHits: 0 };
        }

        const corpus = results
            .slice(0, 3)
            .map(r => `${r?.title || ''} ${r?.content || ''} ${r?.url || ''}`.toLowerCase())
            .join(' ');

        const skuText = String(sku || '').toLowerCase();
        const includesSku = skuText.length > 2 && corpus.includes(skuText);

        const nonTechHits = this.NON_TECH_KEYWORDS.reduce((acc, kw) => acc + (corpus.includes(kw) ? 1 : 0), 0);

        const isValid = includesSku && nonTechHits === 0;
        const reason = isValid ? 'ok' : `low_quality:sku=${includesSku};nonTech=${nonTechHits}`;

        return { isValid, reason, nonTechHits };
    }

    static async search(sku, retries = 2, telemetry = {}) {
        const runId = telemetry.runId || randomUUID();
        const startedAt = Date.now();
        const queries = this.queryVariants(sku);

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const query = queries[Math.min(attempt, queries.length - 1)];
                const response = await tvly.search(query, {
                    searchDepth: "advanced",
                    maxResults: 3,
                    includeImages: false,
                    includeRawContent: false,
                });

                const quality = this.assessSearchQuality(response, sku);

                if (!quality.isValid) {
                    console.warn(`[SearchQuality] SKU ${sku} rechazado por calidad (${quality.reason}) en intento ${attempt + 1}/${retries + 1}`);
                    if (attempt < retries) {
                        continue;
                    }
                }

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
                        quality,
                    },
                    modelIdentifier: 'search/tavily',
                    collaboratorId: telemetry.collaboratorId || null,
                    project: TELEMETRY_PROJECT,
                    module: TELEMETRY_MODULE,
                    agentLogicalName: TELEMETRY_AGENT_LOGICAL,
                    agentPublicName: TELEMETRY_AGENT_PUBLIC,
                    platform: TELEMETRY_PLATFORM,
                });

                return quality.isValid ? response : null;
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