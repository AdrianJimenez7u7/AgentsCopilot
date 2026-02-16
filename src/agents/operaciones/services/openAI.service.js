import { AzureOpenAI } from "openai";
import { Constantes } from "../utils/constantes.js";

const endpoint = "https://ia-generativa.cognitiveservices.azure.com/";
const modelName = "gpt-4.1-mini";
const deployment = "gpt-4.1-mini";

export class OpenAIService {

    static async extractProductData(sku, searchContext) {

        const apiKey = process.env.OPENAI_API_KEY;
        const apiVersion = "2024-05-01-preview";

        const client = new AzureOpenAI({ endpoint, apiKey, apiVersion, deployment });

        // Convertimos el objeto a lista para el prompt (para mantener cálculo de UNSPSC)
        const listaCodigos = Object.entries(Constantes.CodigosClasificacion)
            .map(([codigo, desc]) => `- ${codigo}: ${desc}`)
            .join("\n");

        const systemPrompt = `
        ERES UN AGENTE ESPECIALIZADO EN DATOS COMERCIALES Y FISCALES DE PRODUCTOS. TU OBJETIVO ES RECIBIR UN NÚMERO DE PARTE Y ENTREGAR CON PRECISIÓN Y FORMATO LIMPIO LOS SIGUIENTES DATOS:
 
        - **DESCRIPCIÓN COMERCIAL** (en mayúsculas)  
        - **CLAVE DE PRODUCTO/SERVICIO SAT** (Usa la lista de códigos proporcionada abajo para calcular el UNSPSC más preciso)
        - **CLAVE DE UNIDAD SAT** (SOLO PUEDE SER 'H87' PARA PRODUCTOS FÍSICOS O 'E48' PARA INTANGIBLES/SERVICIOS) 
        - **MARCA**  
        - **NÚMERO DE PARTE**  
        - **MEDIDAS (CENTÍMETROS)**  
        - **PESO (KILOS)**
        
        CATÁLOGO SAT DISPONIBLE PARA REFERENCIA (UNSPSC):
        ${listaCodigos}

        CADA VEZ QUE EL USUARIO INGRESE UN NUEVO NÚMERO DE PARTE, DEBES BORRAR CUALQUIER INFORMACIÓN ANTERIOR Y PRESENTAR LOS DATOS DESDE CERO, CON FORMATO LIMPIO Y COMPLETO.
        
        ###INSTRUCCIONES DE FORMATO###
        
        - MUESTRA SIEMPRE LOS CAMPOS EN EL MISMO ORDEN
        - ASEGURA QUE LA RESPUESTA ESTÉ LIMPIA, SIN RASTROS DE CONSULTAS ANTERIORES
        - SI FALTA ALGÚN DATO, INDICA: 'No disponible'
        - CONVIERTE LA **DESCRIPCIÓN COMERCIAL A MAYÚSCULAS**
        - IMPORTANTE: PARA EL CAMPO "CLAVE DE PRODUCTO/SERVICIO SAT", DEBES USAR TU RAZONAMIENTO PARA ELEGIR EL MEJOR CÓDIGO DE LA LISTA PROPORCIONADA, BASÁNDOTE EN LA FUNCIÓN DEL PRODUCTO.

        ---------------------------------------------------
        TU RESPUESTA DEBE SER EXCLUSIVAMENTE UN OBJETO JSON VÁLIDO CON LA SIGUIENTE ESTRUCTURA:
        {
            "descripcion_comercial": "DESCRIPCIÓN EN MAYÚSCULAS",
            "clave_producto_servicio_sat": "Código UNSPSC calculado",
            "clave_unidad_sat": "H87 (Físico) o E48 (Intangible)",
            "marca": "Marca del producto",
            "numero_parte": "${sku}",
            "medidas_cm": "Largo x Ancho x Alto (ej: 30 x 12 x 10)",
            "peso_kg": 0.0
        }
        ---------------------------------------------------
        `;

        try {
            const response = await client.chat.completions.create({
                model: modelName,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Analiza este producto (SKU: ${sku}).\n\nCONTEXTO TÉCNICO ENCONTRADO:\n${searchContext}` }
                ],
                response_format: { type: "json_object" },
                temperature: 0,
                max_tokens: 2500
            });

            return JSON.parse(response.choices[0].message.content);

        } catch (error) {
            console.error("Error OpenAI:", error);
            throw error;
        }
    }
}