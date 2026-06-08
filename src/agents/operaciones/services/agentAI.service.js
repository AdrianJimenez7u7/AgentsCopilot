import { AzureAIService } from "./azureAI.service.js";
import { EnviosService } from "./db/envios.service.js";
import { DhlService } from "./dhl.service.js";

export class AgentAIService {

    constructor(azureAIService = new AzureAIService(), dhlService = new DhlService(), enviosService = new EnviosService()) {
        this.azureAI = azureAIService;
        this.dhlService = dhlService;
        this.enviosService = enviosService;
    }

    // ─── 1. EXTRACTOR DE INTENCIONES (puede devolver varias) ──────────────────
    async extraerIntenciones(requestData) {
        console.log("RequestData en extracción de intenciones:", requestData);
        const fechaActual = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

        const systemPrompt = `Eres un extractor de intenciones para un agente de IA de Compucad para temas de paqueteria de UPS y DHL México.
Analiza el mensaje y detecta TODAS las intenciones presentes, aunque sean varias en un solo mensaje.

Responde ÚNICAMENTE con un JSON válido, sin Markdown, con este esquema:
{
  "intenciones": [
    {
      "tipo": "validacion_direccion" | "rastreo_envio" | "cotizacion" | "conversacion" | "estado_envios_cotizaciones",
      "datos_completos": true | false,
      "datos": { ... },           // solo si datos_completos = true
      "dato_faltante": "..."      // solo si datos_completos = false, describe qué falta
    }
  ]
}

### Esquema de datos por tipo:
- "validacion_direccion": { "ciudad": "...", "codigo_postal": "..." }
- "rastreo_envio":         { "numero_guia": "..." }
- "cotizacion":           { "origen": "...", "destino": "...", "peso_kg": 0, "largo_cm": 0, "ancho_cm": 0, "alto_cm": 0 }
- "conversacion":         { "texto": "..." }
- "estado_envios_cotizaciones": { "email": "..." }

### Reglas Críticas para "estado_envios_cotizaciones":
1. Si el usuario solicita información de sus envíos, historial, estatus o cotizaciones previas SIN proporcionar un número de guía explícito, la intención DEBE ser obligatoriamente "estado_envios_cotizaciones".
2. Revisa el campo "Usuario email" provisto abajo en el Contexto. Si hay un email válido ahí (diferente a "No proporcionado"), tómalo para el JSON y marca "datos_completos": true.
3. SI Y SOLO SI el "Usuario email" es "No proporcionado" y el usuario tampoco lo escribió en el texto, marca "datos_completos": false y en "dato_faltante" pon "email".

### Reglas Generales:
- Un mensaje puede tener MÚLTIPLES intenciones (ej: rastrear Y cotizar a la vez).
- Si un dato numérico no fue mencionado, ponlo en 0 y marca datos_completos: false.
- Para "conversacion", datos_completos siempre es true.
- Sé generoso extrayendo datos: si dice "a Monterrey", ciudad = "Monterrey".

### Contexto:
- Fecha: ${fechaActual}
- Usuario: ${requestData.user?.name || "No proporcionado"}
- Usuario email: ${requestData.user?.email || "No proporcionado"}
- Historial reciente: ${requestData.history ? JSON.stringify(requestData.history.slice(-4)) : "Ninguno"}`;

        const infoArchivo = requestData.file
            ? `\n[SISTEMA]: El usuario adjuntó el archivo: ${JSON.stringify(requestData.file)}`
            : `\n[SISTEMA]: No se adjuntaron archivos.`;

        const mensaje = `Mensaje del usuario: "${requestData.message}"${infoArchivo}`;
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
                    case "estado_envios_cotizaciones":
                        console.log(`[AgentAIService] Ejecutando servicio para estado_envios_cotizaciones con datos:`, intencion.datos);
                        resultado = await this.#estadoEnviosCotizaciones(intencion.datos);
                        break;
                    default:
                        resultado = null;
                }

                return { ...intencion, resultado };
            })
        );
    }

    // ─── 3. SINTETIZA RESPUESTA FINAL ───────────────────────────────────────
    async procesarMensajeRespuesta(requestData) {
        const historialReciente = requestData.history ? requestData.history.slice(-4) : [];
        const interaccionesStr = requestData.interacciones && requestData.interacciones.length > 0
            ? JSON.stringify(requestData.interacciones)
            : "No se ejecutaron servicios adicionales.";
        const nombreUsuario = requestData.user?.name || "cliente";
        const fechaActual = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

        const tieneCotizacion = Array.isArray(requestData.interacciones)
            && requestData.interacciones.some((item) => item?.tipo === "cotizacion");

        if (tieneCotizacion) {
            return "Claro, para cotizar necesito algunos datos. Por favor compárteme los datos.";
        }

        const systemPrompt = `Eres un asistente de DHL México, amable y natural.
Tu objetivo es redactar UNA SOLA respuesta clara y conversacional basándote en los resultados de los servicios consultados.

REGLAS:
- Si hay datos_completos: false, pide los datos faltantes de forma amable dentro de la misma respuesta.
- Si hay un resultado de servicio, interpreta los datos técnicos y explícalos en lenguaje simple.
- Si hay varias intenciones, atiéndelas todas en orden lógico en un solo párrafo o con saltos de línea naturales.
- Llama al usuario por su nombre de pila si lo tienes.
- No uses listas con viñetas a menos que sea imprescindible para claridad.
- Responde directamente con el texto que leerá el usuario, sin estructuras JSON.
- Máximo 120 palabras.`;

        const mensaje = `
Contexto de la conversación:
- Nombre del usuario: ${nombreUsuario}
- Usuario email: ${requestData.user?.email || "No proporcionado"}
- Historial reciente: ${JSON.stringify(historialReciente)}
- Fecha y hora: ${fechaActual}

Resultados de las acciones del sistema:
${interaccionesStr}

Mensaje actual del usuario: "${requestData.message}"
`;

        return this.azureAI.generarRespuesta(mensaje, systemPrompt);
    }

    // ─── 4. ORQUESTADOR PRINCIPAL ───────────────────────────────────────────
    async procesarMensajeCompleto(requestData) {
        // 1. Extraer intenciones iniciales de la IA
        const extraccionPayload = await this.extraerIntenciones(requestData);
        let intenciones = extraccionPayload.intenciones || [];

        // 1.5 Interceptamos por código: Si es estado_envios_cotizaciones y el email viene en la petición,
        // nos aseguramos de que no se cancele la ejecución por "datos_completos: false" de la IA.
        intenciones = intenciones.map(intencion => {
            if (intencion.tipo === "estado_envios_cotizaciones" && requestData.user?.email) {
                return {
                    ...intencion,
                    datos_completos: true,
                    datos: { email: requestData.user.email },
                    dato_faltante: undefined
                };
            }
            return intencion;
        });

        // 2. Ejecutar lógica de negocio (Ahora sí entrará al switch e imprimirá logs)
        const interacciones = await this.ejecutarServicios(intenciones);

        // 3. Preparar datos para respuesta
        const datosParaRespuesta = {
            ...requestData,
            interacciones
        };

        // 4. Generar respuesta final
        const respuesta = await this.procesarMensajeRespuesta(datosParaRespuesta);

        return {
            intenciones: interacciones,
            respuesta
        };
    }

    // ─── BALANCEADOR DE DECISIONES ────────────────────────────────────────────
    async balanceadorDeDecisiones(requestData) {
        try {
            return await this.procesarMensajeCompleto(requestData);
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

    async #estadoEnviosCotizaciones({ email }) {
        console.log(`[AgentAIService] Consultando estado de envíos y cotizaciones para usuario: ${email || 'No proporcionado'}`);
        try {
            console.log("dentro del try")
            const data = await this.enviosService.getEstatusEnviosUsuario(email);
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