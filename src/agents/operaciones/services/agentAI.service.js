import { AzureAIService } from "./azureAI.service.js";
import { DhlService } from "./dhl.service.js";

export class AgentAIService {

    constructor(azureAIService = new AzureAIService(), dhlService = new DhlService()) {
        this.azureAI = azureAIService;
        this.dhlService = dhlService;
    }

    // ─── 1. EXTRACTOR DE INTENCIONES (puede devolver varias) ──────────────────
    async extraerIntenciones(requestData) {
        const fechaActual = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

        const systemPrompt = `Eres un extractor de intenciones para un chatbot de DHL México.
Analiza el mensaje y detecta TODAS las intenciones presentes, aunque sean varias en un solo mensaje.

Responde ÚNICAMENTE con un JSON válido, sin Markdown, con este esquema:
{
  "intenciones": [
    {
      "tipo": "validacion_direccion" | "rastreo_envio" | "cotizacion" | "conversacion",
      "datos_completos": true | false,
      "datos": { ... },           // solo si datos_completos = true
      "dato_faltante": "..."      // solo si datos_completos = false, describe qué falta
    }
  ]
}

### Esquema de datos por tipo:
- "validacion_direccion": { "ciudad": "...", "codigo_postal": "..." }
- "rastreo_envio":        { "numero_guia": "..." }
- "cotizacion":           { "origen": "...", "destino": "...", "peso_kg": 0, "largo_cm": 0, "ancho_cm": 0, "alto_cm": 0 }
- "conversacion":         { "texto": "..." }

### Reglas:
- Un mensaje puede tener MÚLTIPLES intenciones (ej: rastrear Y cotizar a la vez).
- Si un dato numérico no fue mencionado, ponlo en 0 y marca datos_completos: false.
- Para "conversacion", datos_completos siempre es true.
- Sé generoso extrayendo datos: si dice "a Monterrey", ciudad = "Monterrey".

### Contexto:
- Fecha: ${fechaActual}
- Usuario: ${requestData.user?.name || "No proporcionado"}
- Historial reciente: ${requestData.history ? JSON.stringify(requestData.history.slice(-4)) : "Ninguno"}`;

        const mensaje = `Mensaje del usuario: "${requestData.message}"`;
        const respuesta = await this.azureAI.generarRespuesta(mensaje, systemPrompt);
        const limpio = respuesta.replace(/```json\n?|```/gi, '').trim();
        return JSON.parse(limpio); // { intenciones: [...] }
    }

    // ─── 2. EJECUTA SERVICIOS EN PARALELO ────────────────────────────────────
    async ejecutarServicios(intenciones) {
        return Promise.all(
            intenciones.map(async (intencion) => {
                // Si faltan datos o es conversación, no llamamos a ningún servicio
                if (!intencion.datos_completos || intencion.tipo === "conversacion") {
                    return { ...intencion, resultado: null };
                }

                let resultado;
                switch (intencion.tipo) {
                    case "validacion_direccion":
                        resultado = await this.#validarDireccion(intencion.datos);
                        break;
                    case "rastreo_envio":
                        resultado = await this.#rastrearEnvio(intencion.datos);
                        break;
                    case "cotizacion":
                        resultado = await this.#cotizar(intencion.datos);
                        break;
                    default:
                        resultado = null;
                }

                return { ...intencion, resultado };
            })
        );
    }

    // ─── 3. GENERA RESPUESTA NATURAL UNIFICADA ───────────────────────────────
    async generarRespuestaFinal(requestData, intencionesConResultados) {
        const systemPrompt = `Eres un asistente de DHL México, amable y natural. 
Tu trabajo es redactar UNA SOLA respuesta coherente y conversacional basándote en los resultados de los servicios consultados.

Reglas:
- Si hay datos_completos: false, pide los datos faltantes de forma amable dentro de la misma respuesta.
- Si hay un resultado de servicio, interpreta los datos técnicos y explícalos en lenguaje simple.
- Si hay varias intenciones, atiéndelas todas en orden lógico en un solo párrafo o con saltos de línea naturales.
- Llama al usuario por su nombre de pila si lo tienes.
- No uses listas con viñetas a menos que sea imprescindible para claridad.
- Máximo 120 palabras.`;

        const contexto = `
Usuario: ${requestData.user?.name || "cliente"}
Mensaje original: "${requestData.message}"
Resultados de servicios: ${JSON.stringify(intencionesConResultados, null, 2)}`;

        return this.azureAI.generarRespuesta(contexto, systemPrompt);
    }

    // ─── ORQUESTADOR PRINCIPAL ────────────────────────────────────────────────
    async balanceadorDeDecisiones(requestData) {
        try {
            // Paso 1: extrae todas las intenciones del mensaje
            const { intenciones } = await this.extraerIntenciones(requestData);

            // Paso 2: ejecuta servicios en paralelo
            const intencionesConResultados = await this.ejecutarServicios(intenciones);

            // Paso 3: genera respuesta natural unificada
            const respuestaFinal = await this.generarRespuestaFinal(requestData, intencionesConResultados);

            return {
                intenciones: intencionesConResultados,
                respuesta: respuestaFinal,
            };
        } catch (error) {
            console.error(`[AgentAIService] Error en balanceadorDeDecisiones:`, error?.message ?? error);
            throw new Error(`Error en balanceadorDeDecisiones: ${error?.message ?? String(error)}`);
        }
    }

    // ─── SERVICIOS PRIVADOS ───────────────────────────────────────────────────
    async #validarDireccion({ ciudad, codigo_postal }) {
        try {
            const data = await this.dhlService.validateAddress("MX", codigo_postal, ciudad);
            return { ok: true, data };
        } catch (error) {
            return this.#parsearErrorDHL(error);
        }
    }

    async #rastrearEnvio({ numero_guia }) {
        try {
            const data = await this.dhlService.trackShipment(numero_guia);
            return { ok: true, data };
        } catch (error) {
            return this.#parsearErrorDHL(error);
        }
    }

    async #cotizar(datos) {
        try {
            const data = await this.dhlService.getQuote(datos);
            return { ok: true, data };
        } catch (error) {
            return this.#parsearErrorDHL(error);
        }
    }

    #parsearErrorDHL(error) {
        const message = error?.message ?? String(error);
        const match = message.match(/DHL API Error \((\d+)\):\s*([^:]+):\s*(.*)/);
        return {
            ok: false,
            error: match?.[3]?.trim() || message,
            code: match?.[2]?.trim(),
            status: match?.[1] ? Number(match[1]) : undefined,
        };
    }
}