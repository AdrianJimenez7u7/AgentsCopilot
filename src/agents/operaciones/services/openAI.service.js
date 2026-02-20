import { AzureOpenAI } from "openai";
import { Constantes } from "../utils/constantes.js";

const endpoint = "https://ia-generativa.cognitiveservices.azure.com/";
//const modelName = "gpt-4.1-mini";
const modelName = process.env.AZURE_OPENAI_MODEL;
const deployment = process.env.AZURE_OPENAI_MODEL;

export class OpenAIService {

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

                return JSON.parse(response.choices[0].message.content);

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
}