import { AzureOpenAI } from "openai";
import { Constantes } from "../utils/constantes.js";
import { randomUUID } from 'crypto';
import { logAgentAction, logModelUsage } from '../../../shared/services/agentTelemetry.service.js';

const endpoint = "https://ia-generativa.cognitiveservices.azure.com/";
//const modelName = "gpt-4.1-mini";
const modelName = process.env.AZURE_OPENAI_MODEL;
const deployment = process.env.AZURE_OPENAI_MODEL;

const TELEMETRY_PROJECT = 'AgentsCopilot';
const TELEMETRY_MODULE = 'operaciones';
const TELEMETRY_AGENT_LOGICAL = 'operaciones';
const TELEMETRY_AGENT_PUBLIC = 'Operaciones';
const TELEMETRY_PLATFORM = 'backend';

export class OpenAIService {

    static sanitizeSatClassificationCode(value) {
        const raw = String(value ?? '').trim();
        if (!raw) return '';

        // Normalize values like "43211503.0" or "43211503.00".
        return raw.replace(/^(\d+)\.0+$/, '$1');
    }

    static sanitizeProductoClasificado(producto = {}) {
        if (!producto || typeof producto !== 'object') return producto;

        return {
            ...producto,
            clave_producto_servicio_sat: this.sanitizeSatClassificationCode(producto.clave_producto_servicio_sat),
        };
    }

    static async extractProductData(sku, searchContext, retries = 3) {
        //const apiKey = process.env.OPENAI_API_KEY;
        const apiKey = process.env.AZURE_API_KEY;
        //const apiVersion = "2024-05-01-preview";
        const apiVersion = process.env.AZURE_OPENAI_API_VERSION;
        const client = new AzureOpenAI({ endpoint, apiKey, apiVersion, deployment });

        const listaCodigos = Object.entries(Constantes.CodigosClasificacion)
            .map(([codigo, desc]) => `- ${codigo}: ${desc}`)
            .join("\n");

        const listaMarcas = Object.values(Constantes.CodigoMarcas).join(", ");

        const systemPrompt = `
        ERES UN AGENTE ESPECIALIZADO EN DATOS COMERCIALES Y FISCALES DE PRODUCTOS DE TECNOLOGÍA (HARDWARE, REDES, CÓMPUTO). TU OBJETIVO ES RECIBIR UN NÚMERO DE PARTE Y ENTREGAR CON PRECISIÓN Y FORMATO LIMPIO LOS SIGUIENTES DATOS, PRIORIZANDO SIEMPRE EL CONTEXTO TECNOLÓGICO:
 
        - **DESCRIPCIÓN COMERCIAL** (en mayúsculas)  
        - **CLAVE DE PRODUCTO/SERVICIO SAT** (Usa la lista de códigos proporcionada abajo para calcular el UNSPSC más preciso)
        - **CLAVE DE UNIDAD SAT** (SOLO PUEDE SER 'H87' PARA PRODUCTOS FÍSICOS O 'E48' PARA INTANGIBLES/SERVICIOS) 
        - **MARCA** (OBLIGATORIO: elige EXACTAMENTE una de la lista de marcas autorizada)
        - **NÚMERO DE PARTE**  
        - **MEDIDAS (CENTÍMETROS)**  
        - **PESO (KILOS)**
        
        CATÁLOGO SAT DISPONIBLE PARA REFERENCIA (UNSPSC):
        ${listaCodigos}

        LISTA DE MARCAS AUTORIZADAS (debes elegir la más cercana al fabricante real, usando EXACTAMENTE el texto de esta lista):
        ${listaMarcas}

        CADA VEZ QUE EL USUARIO INGRESE UN NUEVO NÚMERO DE PARTE, DEBES BORRAR CUALQUIER INFORMACIÓN ANTERIOR Y PRESENTAR LOS DATOS DESDE CERO, CON FORMATO LIMPIO Y COMPLETO.
        
        ###INSTRUCCIONES DE FORMATO###
        
        - MUESTRA SIEMPRE LOS CAMPOS EN EL MISMO ORDEN
        - ASEGURA QUE LA RESPUESTA ESTÉ LIMPIA, SIN RASTROS DE CONSULTAS ANTERIORES
        - SI FALTA ALGÚN DATO, INDICA: 'No disponible'
        - CONVIERTE LA **DESCRIPCIÓN COMERCIAL A MAYÚSCULAS**
        - PARA **MARCA**: usa ÚNICAMENTE los valores exactos de la lista de marcas autorizadas. Si el fabricante es "HP", usa "HP INC". Si no encuentras coincidencia, pon "No disponible".
        - IMPORTANTE: PARA EL CAMPO "CLAVE DE PRODUCTO/SERVICIO SAT", DEBES USAR TU RAZONAMIENTO PARA ELEGIR EL MEJOR CÓDIGO DE LA LISTA PROPORCIONADA, BASÁNDOTE EN LA FUNCIÓN DEL PRODUCTO.

        ---------------------------------------------------
        TU RESPUESTA DEBE SER EXCLUSIVAMENTE UN OBJETO JSON VÁLIDO CON LA SIGUIENTE ESTRUCTURA:
        {
            "descripcion_comercial": "DESCRIPCIÓN EN MAYÚSCULAS",
            "clave_producto_servicio_sat": "Código UNSPSC calculado",
            "clave_unidad_sat": "H87 (Físico) o E48 (Intangible)",
            "marca": "Nombre exacto de la lista de marcas autorizadas",
            "numero_parte": "${sku}",
            "medidas_cm": "Largo x Ancho x Alto (ej: 30 x 12 x 10)",
            "peso_kg": 0.0
        }
        ---------------------------------------------------
        `;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const safeContext = (searchContext || '').slice(0, 6000);
                const userMsg = `Analiza este producto (SKU: ${sku}).\n\nCONTEXTO TÉCNICO ENCONTRADO:\n${safeContext}`;
                // Estimate: ~4 chars per token (OpenAI standard heuristic)
                const estSystem = Math.ceil(systemPrompt.length / 4);
                const estUser = Math.ceil(userMsg.length / 4);
                console.log(`[OpenAI] SKU: ${sku} | tokens estimados → system: ${estSystem} | user: ${estUser} | total: ${estSystem + estUser}`);

                const response = await client.chat.completions.create({
                    model: modelName,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userMsg }
                    ],
                    response_format: { type: "json_object" },
                    temperature: 0,
                    max_tokens: 2500
                });

                const parsed = JSON.parse(response.choices[0].message.content);
                return this.sanitizeProductoClasificado(parsed);

            } catch (error) {
                const isRateLimit = error?.status === 429 || error?.code === 'RateLimitReached';

                if (isRateLimit && attempt < retries) {
                    // Read retry-after from headers, default to 10s
                    const retryAfter = parseInt(error?.headers?.['retry-after'] ?? '10', 10);
                    const waitMs = (retryAfter + 1) * 1000; // +1s buffer
                    console.warn(`OpenAI rate limit for SKU ${sku}. Retrying in ${retryAfter + 1}s (attempt ${attempt + 1}/${retries})...`);
                    await new Promise(r => setTimeout(r, waitMs));
                } else {
                    console.error(`OpenAI error for SKU ${sku}:`, error?.message ?? error);
                    throw error;
                }
            }
        }
    }

    static async clasificarProducto(sku, searchContext, retries = 3) {
        const apiKey = process.env.AZURE_API_KEY;
        const apiVersion = process.env.AZURE_OPENAI_API_VERSION;
        const client = new AzureOpenAI({ endpoint, apiKey, apiVersion, deployment });

        const listaCodigos = Object.entries(Constantes.CodigosClasificacion)
            .map(([codigo, desc]) => `- ${codigo}: ${desc}`)
            .join("\n");

        const listaMarcas = Object.values(Constantes.CodigoMarcas).join(", ");

        const systemPrompt = `
        ERES UN AGENTE ESPECIALIZADO EN DATOS COMERCIALES Y FISCALES DE PRODUCTOS DE TECNOLOGÍA (HARDWARE, REDES, CÓMPUTO). TU OBJETIVO ES RECIBIR UN NÚMERO DE PARTE Y ENTREGAR CON PRECISIÓN Y FORMATO LIMPIO LOS SIGUIENTES DATOS, PRIORIZANDO SIEMPRE EL CONTEXTO TECNOLÓGICO:
 
        - **DESCRIPCIÓN COMERCIAL** (en mayúsculas)  
        - **CLAVE DE PRODUCTO/SERVICIO SAT** (Usa la lista de códigos proporcionada abajo para calcular el UNSPSC más preciso)
        - **CLAVE DE UNIDAD SAT** (SOLO PUEDE SER 'H87' PARA PRODUCTOS FÍSICOS O 'E48' PARA INTANGIBLES/SERVICIOS) 
        - **MARCA** (OBLIGATORIO: elige EXACTAMENTE una de la lista de marcas autorizada)
        - **NÚMERO DE PARTE**  
        - **MEDIDAS (CENTÍMETROS)**  
        - **PESO (KILOS)**
        - **TOKENS ENTRADA** (Número de tokens utilizados en la entrada)
        - **TOKENS SALIDA** (Número de tokens utilizados en la salida)
        - **TOKENS TOTAL** (Número total de tokens utilizados)
        
        CATÁLOGO SAT DISPONIBLE PARA REFERENCIA (UNSPSC):
        ${listaCodigos}

        LISTA DE MARCAS AUTORIZADAS (debes elegir la más cercana al fabricante real, usando EXACTAMENTE el texto de esta lista):
        ${listaMarcas}

        CATALOGO DE PRODUCTOS Y SERVICIOS SAT:
        ${Constantes.CatalogoProdServSatMarkitdown}

        CADA VEZ QUE EL USUARIO INGRESE UN NUEVO NÚMERO DE PARTE, DEBES BORRAR CUALQUIER INFORMACIÓN ANTERIOR Y PRESENTAR LOS DATOS DESDE CERO, CON FORMATO LIMPIO Y COMPLETO.
        
        ###INSTRUCCIONES DE FORMATO###
        
        - MUESTRA SIEMPRE LOS CAMPOS EN EL MISMO ORDEN
        - ASEGURA QUE LA RESPUESTA ESTÉ LIMPIA, SIN RASTROS DE CONSULTAS ANTERIORES
        - SI FALTA ALGÚN DATO, INDICA: 'No disponible'
        - CONVIERTE LA **DESCRIPCIÓN COMERCIAL A MAYÚSCULAS**
        - PARA **MARCA**: usa ÚNICAMENTE los valores exactos de la lista de marcas autorizadas. Si el fabricante es "HP", usa "HP INC". Si no encuentras coincidencia, pon "No disponible".
        - IMPORTANTE: PARA EL CAMPO "CLAVE DE PRODUCTO/SERVICIO SAT", DEBES USAR TU RAZONAMIENTO PARA ELEGIR EL MEJOR CÓDIGO DE LA LISTA PROPORCIONADA, BASÁNDOTE EN LA FUNCIÓN DEL PRODUCTO.

        ---------------------------------------------------
        TU RESPUESTA DEBE SER EXCLUSIVAMENTE UN OBJETO JSON VÁLIDO CON LA SIGUIENTE ESTRUCTURA:
        {
            "descripcion_comercial": "DESCRIPCIÓN EN MAYÚSCULAS",
            "clave_producto_servicio_sat": "Código UNSPSC calculado",
            "clave_unidad_sat": "H87 (Físico) o E48 (Intangible)",
            "marca": "Nombre exacto de la lista de marcas autorizadas",
            "numero_parte": "${sku}",
            "medidas_cm": "Largo x Ancho x Alto (ej: 30 x 12 x 10)",
            "peso_kg": 0.0,
            "tokens_entrada": 0,
            "tokens_salida": 0,
            "tokens_total": 0
        }
        ---------------------------------------------------
        `;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const safeContext = (searchContext || '').slice(0, 6000);
                const userMsg = `Analiza este producto (SKU: ${sku}).\n\nCONTEXTO TÉCNICO ENCONTRADO:\n${safeContext}`;
                // Estimate: ~4 chars per token (OpenAI standard heuristic)
                const estSystem = Math.ceil(systemPrompt.length / 4);
                const estUser = Math.ceil(userMsg.length / 4);
                console.log(`[OpenAI] SKU: ${sku} | tokens estimados → system: ${estSystem} | user: ${estUser} | total: ${estSystem + estUser}`);

                const response = await client.chat.completions.create({
                    model: modelName,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userMsg }
                    ],
                    response_format: { type: "json_object" },
                    temperature: 0,
                    max_tokens: 2500
                });

                const parsed = JSON.parse(response.choices[0].message.content);
                return this.sanitizeProductoClasificado(parsed);

            } catch (error) {
                const isRateLimit = error?.status === 429 || error?.code === 'RateLimitReached';

                if (isRateLimit && attempt < retries) {
                    // Read retry-after from headers, default to 10s
                    const retryAfter = parseInt(error?.headers?.['retry-after'] ?? '10', 10);
                    const waitMs = (retryAfter + 1) * 1000; // +1s buffer
                    console.warn(`OpenAI rate limit for SKU ${sku}. Retrying in ${retryAfter + 1}s (attempt ${attempt + 1}/${retries})...`);
                    await new Promise(r => setTimeout(r, waitMs));
                } else {
                    console.error(`OpenAI error for SKU ${sku}:`, error?.message ?? error);
                    throw error;
                }
            }
        }
    }

    /**
     * Clasifica un producto usando el modelo de razonamiento gpt-5-mini (AZURE_OPENAI_5_1_MINI_*).
     * Retorna el JSON de clasificación más los tokens REALES consumidos desde response.usage.
     */
    static async clasificarProductoRazonamiento(sku, searchContext, retries = 3, telemetry = {}) {
        const apiKey = process.env.AZURE_OPENAI_5_MINI_API_KEY;
        const apiVersion = process.env.AZURE_OPENAI_5_MINI_API_VERSION;
        const endpoint5 = process.env.AZURE_OPENAI_5_MINI_ENDPOINT;
        const model5 = process.env.AZURE_OPENAI_5_MINI_MODEL; // gpt-5-mini
        const runId = telemetry.runId || randomUUID();

        const client = new AzureOpenAI({ endpoint: endpoint5, apiKey, apiVersion, deployment: model5 });

        const listaCodigos = Object.entries(Constantes.CodigosClasificacion)
            .map(([codigo, desc]) => `- ${codigo}: ${desc}`)
            .join("\n");

        const listaMarcas = Object.values(Constantes.CodigoMarcas).join(", ");

        const systemPrompt = `
        ERES UN AGENTE ESPECIALIZADO EN DATOS COMERCIALES Y FISCALES DE PRODUCTOS DE TECNOLOGÍA (HARDWARE, REDES, CÓMPUTO). TU OBJETIVO ES RECIBIR UN NÚMERO DE PARTE Y ENTREGAR CON PRECISIÓN Y FORMATO LIMPIO LOS SIGUIENTES DATOS, PRIORIZANDO SIEMPRE EL CONTEXTO TECNOLÓGICO:
 
        - **DESCRIPCIÓN COMERCIAL** (en mayúsculas)  
        - **CLAVE DE PRODUCTO/SERVICIO SAT** (Usa la lista de códigos proporcionada abajo para calcular el UNSPSC más preciso)
        - **CLAVE DE UNIDAD SAT** (SOLO PUEDE SER 'H87' PARA PRODUCTOS FÍSICOS O 'E48' PARA INTANGIBLES/SERVICIOS) 
        - **MARCA** (OBLIGATORIO: elige EXACTAMENTE una de la lista de marcas autorizada)
        - **NÚMERO DE PARTE**  
        - **MEDIDAS (CENTÍMETROS)**  
        - **PESO (KILOS)**
        
        CATÁLOGO SAT DISPONIBLE PARA REFERENCIA (UNSPSC):
        ${listaCodigos}

        LISTA DE MARCAS AUTORIZADAS (debes elegir la más cercana al fabricante real, usando EXACTAMENTE el texto de esta lista):
        ${listaMarcas}

        CATALOGO DE PRODUCTOS Y SERVICIOS SAT:
        ${Constantes.CatalogoProdServSatMarkitdown}

        CADA VEZ QUE EL USUARIO INGRESE UN NUEVO NÚMERO DE PARTE, DEBES BORRAR CUALQUIER INFORMACIÓN ANTERIOR Y PRESENTAR LOS DATOS DESDE CERO, CON FORMATO LIMPIO Y COMPLETO.
        
        ###INSTRUCCIONES DE FORMATO###
        
        - MUESTRA SIEMPRE LOS CAMPOS EN EL MISMO ORDEN
        - ASEGURA QUE LA RESPUESTA ESTÉ LIMPIA, SIN RASTROS DE CONSULTAS ANTERIORES
        - SI FALTA ALGÚN DATO, INDICA: 'No disponible'
        - CONVIERTE LA **DESCRIPCIÓN COMERCIAL A MAYÚSCULAS**
        - PARA **MARCA**: usa ÚNICAMENTE los valores exactos de la lista de marcas autorizadas. Si el fabricante es "HP", usa "HP INC". Si no encuentras coincidencia, pon "No disponible".
        - IMPORTANTE: PARA EL CAMPO "CLAVE DE PRODUCTO/SERVICIO SAT", DEBES USAR TU RAZONAMIENTO PARA ELEGIR EL MEJOR CÓDIGO DE LA LISTA PROPORCIONADA, BASÁNDOTE EN LA FUNCIÓN DEL PRODUCTO.

        ---------------------------------------------------
        TU RESPUESTA DEBE SER EXCLUSIVAMENTE UN OBJETO JSON VÁLIDO CON LA SIGUIENTE ESTRUCTURA:
        {
            "descripcion_comercial": "DESCRIPCIÓN EN MAYÚSCULAS",
            "clave_producto_servicio_sat": "Código UNSPSC calculado",
            "clave_unidad_sat": "H87 (Físico) o E48 (Intangible)",
            "marca": "Nombre exacto de la lista de marcas autorizadas",
            "numero_parte": "${sku}",
            "medidas_cm": "Largo x Ancho x Alto (ej: 30 x 12 x 10)",
            "peso_kg": 0.0
        }
        ---------------------------------------------------
        `;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const startedAt = Date.now();
                const safeContext = (searchContext || '').slice(0, 6000);
                const userMsg = `Analiza este producto (SKU: ${sku}).\n\nCONTEXTO TÉCNICO ENCONTRADO:\n${safeContext}`;

                const estSystem = Math.ceil(systemPrompt.length / 4);
                const estUser = Math.ceil(userMsg.length / 4);
                console.log(`[Razonamiento] SKU: ${sku} | modelo: ${model5} | tokens estimados → system: ${estSystem} | user: ${estUser} | total: ${estSystem + estUser}`);

                const response = await client.chat.completions.create({
                    model: model5,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userMsg }
                    ],
                    response_format: { type: "json_object" },
                    max_completion_tokens: 16000,  // reasoning models require max_completion_tokens
                });

                const resultado = this.sanitizeProductoClasificado(
                    JSON.parse(response.choices[0].message.content)
                );

                // Tokens REALES de la API — no depende de que el modelo los calcule
                resultado.tokens_entrada = response.usage?.prompt_tokens ?? 0;
                resultado.tokens_salida = response.usage?.completion_tokens ?? 0;
                resultado.tokens_total = response.usage?.total_tokens ?? 0;
                resultado.modelo = model5;

                console.log(`[Razonamiento] SKU: ${sku} | tokens reales → entrada: ${resultado.tokens_entrada} | salida: ${resultado.tokens_salida} | total: ${resultado.tokens_total}`);

                const modelIdentifier = `azure-openai/${model5}`;
                const durationMs = Date.now() - startedAt;

                await logModelUsage({
                    runId,
                    sessionId: telemetry.sessionId || null,
                    collaboratorId: telemetry.collaboratorId || null,
                    tokensInput: Number(resultado.tokens_entrada || 0),
                    tokensOutput: Number(resultado.tokens_salida || 0),
                    tokensTotal: Number(resultado.tokens_total || 0),
                    timeEjecucionSec: durationMs / 1000,
                    modelIdentifier,
                    project: TELEMETRY_PROJECT,
                    module: TELEMETRY_MODULE,
                    agentLogicalName: TELEMETRY_AGENT_LOGICAL,
                    agentPublicName: TELEMETRY_AGENT_PUBLIC,
                    platform: TELEMETRY_PLATFORM,
                });

                await logAgentAction({
                    runId,
                    sessionId: telemetry.sessionId || null,
                    actionType: 'llm_call',
                    stepId: `analisis:${sku}`,
                    description: `Clasificación SKU ${sku} con modelo de razonamiento`,
                    status: 'completed',
                    tokensInput: Number(resultado.tokens_entrada || 0),
                    tokensOutput: Number(resultado.tokens_salida || 0),
                    tokensTotal: Number(resultado.tokens_total || 0),
                    durationMs,
                    payload: { sku, model: model5 },
                    modelIdentifier,
                    project: TELEMETRY_PROJECT,
                    module: TELEMETRY_MODULE,
                    agentLogicalName: TELEMETRY_AGENT_LOGICAL,
                    agentPublicName: TELEMETRY_AGENT_PUBLIC,
                    platform: TELEMETRY_PLATFORM,
                });

                return resultado;

            } catch (error) {
                const isRateLimit = error?.status === 429 || error?.code === 'RateLimitReached';

                if (isRateLimit && attempt < retries) {
                    const retryAfter = parseInt(error?.headers?.['retry-after'] ?? '10', 10);
                    const waitMs = (retryAfter + 1) * 1000;
                    console.warn(`[Razonamiento] Rate limit SKU ${sku}. Reintentando en ${retryAfter + 1}s (intento ${attempt + 1}/${retries})...`);
                    await new Promise(r => setTimeout(r, waitMs));
                } else {
                    console.error(`[Razonamiento] Error SKU ${sku}:`, error?.message ?? error);
                    throw error;
                }
            }
        }
    }

    /**
     * Clasifica MÚLTIPLES SKUs en una sola llamada al modelo de razonamiento.
     * El system prompt (≈60k tokens) se envía UNA SOLA VEZ sin importar cuántos SKUs sean.
     * @param {Array<{sku: string, context: string}>} items
     * @returns {Array<Object>} array de productos clasificados, en el mismo orden que items
     */
    static async clasificarProductosLote(items, retries = 3, telemetry = {}) {
        const apiKey = process.env.AZURE_OPENAI_5_MINI_API_KEY;
        const apiVersion = process.env.AZURE_OPENAI_5_MINI_API_VERSION;
        const endpoint5 = process.env.AZURE_OPENAI_5_MINI_ENDPOINT;
        const model5 = process.env.AZURE_OPENAI_5_MINI_MODEL;
        const runId = telemetry.runId || randomUUID();

        const client = new AzureOpenAI({ endpoint: endpoint5, apiKey, apiVersion, deployment: model5 });

        const listaCodigos = Object.entries(Constantes.CodigosClasificacion)
            .map(([codigo, desc]) => `- ${codigo}: ${desc}`)
            .join("\n");

        const listaMarcas = Object.values(Constantes.CodigoMarcas).join(", ");

        const systemPrompt = `
        ERES UN AGENTE ESPECIALIZADO EN DATOS COMERCIALES Y FISCALES DE PRODUCTOS DE TECNOLOGÍA (HARDWARE, REDES, CÓMPUTO).
        RECIBIRÁS UN LOTE DE NÚMEROS DE PARTE, CADA UNO CON SU CONTEXTO TÉCNICO.
        TU OBJETIVO ES CLASIFICAR TODOS Y CADA UNO DE ELLOS CON PRECISIÓN.

        PARA CADA PRODUCTO DEBES DETERMINAR:
        - **DESCRIPCIÓN COMERCIAL** (en mayúsculas)
        - **CLAVE DE PRODUCTO/SERVICIO SAT** (UNSPSC más preciso según la lista de abajo)
        - **CLAVE DE UNIDAD SAT** (SOLO 'H87' PARA FÍSICOS O 'E48' PARA INTANGIBLES/SERVICIOS)
        - **MARCA** (EXACTAMENTE una de la lista de marcas autorizadas)
        - **NÚMERO DE PARTE** (el mismo que recibiste)
        - **MEDIDAS (CENTÍMETROS)**
        - **PESO (KILOS)**

        CATÁLOGO SAT DISPONIBLE PARA REFERENCIA (UNSPSC):
        ${listaCodigos}

        LISTA DE MARCAS AUTORIZADAS (usa EXACTAMENTE el texto de esta lista):
        ${listaMarcas}

        CATALOGO DE PRODUCTOS Y SERVICIOS SAT:
        ${Constantes.CatalogoProdServSatMarkitdown}

        ###INSTRUCCIONES DE FORMATO###
        - SI FALTA ALGÚN DATO, INDICA: 'No disponible'
        - DESCRIPCIÓN COMERCIAL SIEMPRE EN MAYÚSCULAS
        - PARA MARCA: Si el fabricante es "HP", usa "HP INC". Si no hay coincidencia exacta, usa "No disponible"
        - CLASIFICA TODOS LOS PRODUCTOS DEL LOTE SIN OMITIR NINGUNO

        ---------------------------------------------------
        TU RESPUESTA DEBE SER EXCLUSIVAMENTE UN OBJETO JSON VÁLIDO CON ESTA ESTRUCTURA:
        {
            "productos": [
                {
                    "descripcion_comercial": "DESCRIPCIÓN EN MAYÚSCULAS",
                    "clave_producto_servicio_sat": "Código UNSPSC",
                    "clave_unidad_sat": "H87 o E48",
                    "marca": "Nombre exacto de la lista",
                    "numero_parte": "SKU original",
                    "medidas_cm": "Largo x Ancho x Alto",
                    "peso_kg": 0.0
                }
            ]
        }
        EL ARRAY "productos" DEBE TENER EXACTAMENTE ${items.length} ELEMENTOS, UNO POR CADA SKU RECIBIDO.
        ---------------------------------------------------
        `;

        // Build the user message: all SKUs with trimmed contexts (1500 chars each to control size)
        const userMsg = items.map((item, idx) => {
            const safeCtx = (item.context || '').slice(0, 1500);
            return `--- PRODUCTO ${idx + 1} ---\nSKU: ${item.sku}\nCONTEXTO:\n${safeCtx}`;
        }).join("\n\n");

        const estSystem = Math.ceil(systemPrompt.length / 4);
        const estUser = Math.ceil(userMsg.length / 4);
        console.log(`[Lote] ${items.length} SKUs | tokens estimados → system: ${estSystem} | user: ${estUser} | total: ${estSystem + estUser}`);

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const startedAt = Date.now();
                const response = await client.chat.completions.create({
                    model: model5,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: `Clasifica el siguiente lote de ${items.length} productos:\n\n${userMsg}` }
                    ],
                    response_format: { type: "json_object" },
                    max_completion_tokens: 16000,
                });

                const parsed = JSON.parse(response.choices[0].message.content);
                const productos = (parsed.productos ?? []).map((p) => this.sanitizeProductoClasificado(p));

                const tokensEntrada = response.usage?.prompt_tokens ?? 0;
                const tokensSalida = response.usage?.completion_tokens ?? 0;
                const tokensTotal = response.usage?.total_tokens ?? 0;

                console.log(`[Lote] tokens reales → entrada: ${tokensEntrada} | salida: ${tokensSalida} | total: ${tokensTotal}`);
                console.log(`[Lote] ahorro vs individual: ~${((tokensEntrada * (items.length - 1))).toLocaleString()} tokens evitados`);

                const modelIdentifier = `azure-openai/${model5}`;
                const durationMs = Date.now() - startedAt;

                await logModelUsage({
                    runId,
                    sessionId: telemetry.sessionId || null,
                    collaboratorId: telemetry.collaboratorId || null,
                    tokensInput: Number(tokensEntrada || 0),
                    tokensOutput: Number(tokensSalida || 0),
                    tokensTotal: Number(tokensTotal || 0),
                    timeEjecucionSec: durationMs / 1000,
                    modelIdentifier,
                    project: TELEMETRY_PROJECT,
                    module: TELEMETRY_MODULE,
                    agentLogicalName: TELEMETRY_AGENT_LOGICAL,
                    agentPublicName: TELEMETRY_AGENT_PUBLIC,
                    platform: TELEMETRY_PLATFORM,
                });

                await logAgentAction({
                    runId,
                    sessionId: telemetry.sessionId || null,
                    actionType: 'llm_batch_call',
                    stepId: 'analisis:lote',
                    description: `Clasificación por lote de ${items.length} SKUs`,
                    status: 'completed',
                    tokensInput: Number(tokensEntrada || 0),
                    tokensOutput: Number(tokensSalida || 0),
                    tokensTotal: Number(tokensTotal || 0),
                    durationMs,
                    payload: { items: items.length, model: model5 },
                    modelIdentifier,
                    project: TELEMETRY_PROJECT,
                    module: TELEMETRY_MODULE,
                    agentLogicalName: TELEMETRY_AGENT_LOGICAL,
                    agentPublicName: TELEMETRY_AGENT_PUBLIC,
                    platform: TELEMETRY_PLATFORM,
                });

                // Map results by numero_parte (safe), fallback to positional order
                const byParte = new Map(productos.map(p => [String(p.numero_parte ?? '').toUpperCase(), p]));
                return items.map((item, idx) =>
                    byParte.get(item.sku.toUpperCase()) ?? productos[idx] ?? null
                );

            } catch (error) {
                const isRateLimit = error?.status === 429 || error?.code === 'RateLimitReached';
                if (isRateLimit && attempt < retries) {
                    const retryAfter = parseInt(error?.headers?.['retry-after'] ?? '10', 10);
                    const waitMs = (retryAfter + 1) * 1000;
                    console.warn(`[Lote] Rate limit. Reintentando en ${retryAfter + 1}s (intento ${attempt + 1}/${retries})...`);
                    await new Promise(r => setTimeout(r, waitMs));
                } else {
                    console.error(`[Lote] Error:`, error?.message ?? error);
                    throw error;
                }
            }
        }
    }
}