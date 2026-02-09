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

        // Convertimos el objeto a lista para el prompt
        const listaCodigos = Object.entries(Constantes.CodigosClasificacion)
            .map(([codigo, desc]) => `- ${codigo}: ${desc}`)
            .join("\n");

        const systemPrompt = `
        Eres un Clasificador Experto de Materiales para SAP (Master Data).
        Tu prioridad absoluta es asignar el código UNSPSC (SAT) correcto basándote en la función técnica del producto.

        CATÁLOGO SAT DISPONIBLE:
        ${listaCodigos}

        ---------------------------------------------------
        REGLAS DE RAZONAMIENTO "GOLDEN RULES":
        ---------------------------------------------------
        
        1. REGLAS PARA SOFTWARE (CRÍTICO):
           - Si el software sirve para RESPALDO (Backup), RECUPERACIÓN, ANTIVIRUS, FIREWALL o PROTECCIÓN DE DATOS (Ej: Veeam, Acronis, Symantec, Fortinet) -> DEBES USAR "43233200" (Software de seguridad y protección).
           - Si es un SISTEMA OPERATIVO (Windows, Linux) -> Usa "43233000".
           - Si gestiona REDES o CONECTIVIDAD (Cisco, Aruba) -> Usa "43232800".
           - Si es para DISEÑO/ARQUITECTURA (CAD, Adobe) -> Usa "43232604".
           - ÚNICAMENTE si no es ninguno de los anteriores, usa "43232600" (Software específico industria) o "81112501" (Licencias).

        2. REGLAS PARA HARDWARE:
           - Distingue entre "Computador" (la máquina completa) y "Accesorio".
           - Una Laptop SIEMPRE es "43231503" (Notebook).
           - Un Mouse, Teclado o Mochila son Accesorios.

        3. EXTRACCIÓN DE DATOS:
           - Peso y medidas: Solo números (float) en KG y CM. Si es licencia digital, todo es 0.
           - Imagen: Busca la URL más representativa.

        ESTRUCTURA DE RESPUESTA JSON:
        {
            "sku": "${sku}",
            "descripcion_corta": "Máx 40 caracteres, comercial y clara",
            "descripcion_larga": "Descripción técnica detallada",
            "marca": "String",
            "unidad_medida": "PZA (Físico) o E48/H87 (Servicio/Licencia si aplica)",
            "razonamiento_clasificacion": "Explica POR QUÉ elegiste ese código (ej: 'Es Veeam, sirve para backup, por tanto es Seguridad')",
            "codigo_clasificacion_sat": "CÓDIGO DE 8 DÍGITOS",
            "nombre_clasificacion_sat": "NOMBRE EXACTO DE LA LISTA",
            "especificaciones_tecnicas": ["Lista de bullets"],
            "peso_kg": 0.0,
            "altura_cm": 0.0,
            "ancho_cm": 0.0,
            "longitud_cm": 0.0,
            "imagen_url": "url",
            "estatus": "Activo/Obsoleto"
        }
        `;

        try {
            const response = await client.chat.completions.create({
                model: modelName,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Analiza este producto (SKU: ${sku}) y clasifícalo correctamente.\n\nCONTEXTO TÉCNICO:\n${searchContext}` }
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