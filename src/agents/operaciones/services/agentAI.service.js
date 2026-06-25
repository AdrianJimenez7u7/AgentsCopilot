import { AzureAIService } from "./azureAI.service.js";
import { EnviosService } from "./db/envios.service.js";
import { DhlService } from "./dhl.service.js";
import { SearchService } from "./search.service.js";
import { OpenAIService } from "./openAI.service.js";
import { SapService } from "./sap.service.js";
import { prisma } from "../../../shared/prisma/client.js";
import { randomUUID } from "crypto";

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
      "tipo": "validacion_direccion" | "rastreo_envio" | "cotizacion" | "conversacion" | "estado_envios_cotizaciones" | "cruce_result" | "clasificacion_sku",
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
- "cruce_result":         { }   // El cruce se realiza sobre el archivo Excel adjunto (requestData.file)
- "clasificacion_sku":    { "sku": "..." }

### Reglas Críticas para "clasificacion_sku":
1. Si el usuario proporciona un SKU, número de parte o código de producto y pide clasificarlo, buscarlo, o saber qué es ese producto, la intención DEBE ser "clasificacion_sku" con datos { "sku": "..." } y "datos_completos": true.
2. Si pide clasificar/buscar un producto pero NO proporciona el código, marca "datos_completos": false y en "dato_faltante" pon "sku".

### Reglas Críticas para "cruce_result":
1. Si el usuario adjuntó un archivo (ver bloque [SISTEMA]) y pide cruzar, comparar, conciliar o validar un listado de guías/envíos contra el sistema, la intención DEBE ser "cruce_result".
2. Si hay archivo adjunto, marca "datos_completos": true. Si NO hay archivo, marca "datos_completos": false y en "dato_faltante" pon "archivo".

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
    async ejecutarServicios(intenciones, requestData = {}) {
        const emailUsuario = requestData.user?.email ?? null;
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
                        // El frontend maneja el rastreo; solo retornamos la intención con los datos
                        resultado = null;
                        break;
                    case "cotizacion":
                        resultado = await this.#cotizar(intencion.datos);
                        break;
                    case "estado_envios_cotizaciones":
                        console.log(`[AgentAIService] Ejecutando servicio para estado_envios_cotizaciones con datos:`, intencion.datos);
                        resultado = await this.#estadoEnviosCotizaciones(intencion.datos);
                        break;
                    case "cruce_result":
                        // TODO: conectar el cruce aquí usando el archivo adjunto (requestData.file),
                        // p.ej. this.enviosService.relacionarGuiasExcelConColaboradores(filePath).
                        resultado = null;
                        break;
                    case "clasificacion_sku":
                        resultado = await this.#clasificarSku(intencion.datos, emailUsuario);
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
- Para clasificación de productos (clasificacion_sku): si el SKU ya está registrado en SAP, infórmalo y aclara que no se envió a validación. Si fue enviado a validación, dile al usuario que en la vista de validación puede aprobarlo y desde ahí subir el artículo a SAP (eso es un paso aparte).
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
        const interacciones = await this.ejecutarServicios(intenciones, requestData);

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
        // Intento 1: strictValidation=false para tolerar variantes de nombre de ciudad
        try {
            const data = await this.dhlService.validateAddress("MX", codigo_postal, ciudad, false);
            return { ok: true, data };
        } catch (e1) {
            // Intento 2: sin nombre de ciudad, solo CP (DHL puede identificar la zona por CP)
            try {
                const data = await this.dhlService.validateAddress("MX", codigo_postal, "", false);
                return { ok: true, data };
            } catch (e2) {
                return this.#parsearErrorDHL(e2);
            }
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

    // Búsqueda + clasificación de un producto por SKU individual y envío a validación.
    async #clasificarSku({ sku } = {}, email = null) {
        if (!sku) return { ok: false, error: "SKU es requerido" };

        const userEmail = email || "bot@copilot.com";

        // 1. ¿Ya está registrado como artículo en SAP? (no lo reprocesamos)
        try {
            const { existe, item } = await SapService.existeItemPorCodigo(sku);
            if (existe) {
                return {
                    ok: true,
                    sku,
                    yaRegistrado: true,
                    enValidacion: false,
                    fuente: "SAP",
                    item,
                    nota: `El SKU ${sku} ya está registrado como artículo en SAP (${item?.itemName ?? ''}). No se envió a validación.`
                };
            }
        } catch (e) {
            // No bloqueamos el flujo si SAP no responde; seguimos con la clasificación.
            console.error(`[clasificacion_sku] No se pudo verificar el item ${sku} en SAP:`, e?.message ?? e);
        }

        // 2. ¿Ya está en validación pendiente? (evita duplicados)
        const yaPendiente = await prisma.productoPendienteValidation.findFirst({
            where: { sku },
            orderBy: { createdAt: 'desc' }
        });
        if (yaPendiente) {
            return {
                ok: true,
                sku,
                yaRegistrado: false,
                enValidacion: true,
                idValidacion: yaPendiente.id,
                data: yaPendiente,
                nota: `El SKU ${sku} ya estaba en validación (estatus: ${yaPendiente.status}). En la vista de validación puedes aprobarlo y subir el artículo a SAP.`
            };
        }

        // 3. Buscar en web + clasificar con el modelo de razonamiento
        const telemetry = { runId: randomUUID(), collaboratorId: email };
        let producto;
        try {
            const rawResults = await SearchService.search(sku, 2, telemetry);
            if (!rawResults?.results?.length) {
                return { ok: false, sku, error: `No se encontró contexto web confiable para el SKU ${sku}.` };
            }
            producto = await OpenAIService.clasificarProductoRazonamiento(sku, JSON.stringify(rawResults), 3, telemetry);
        } catch (error) {
            return { ok: false, sku, error: error?.message ?? String(error) };
        }

        // 4. Enviar a validación (guardar como Pendiente)
        try {
            const nuevo = await prisma.productoPendienteValidation.create({
                data: {
                    sku: producto.numero_parte || sku,
                    descripcion_comercial: producto.descripcion_comercial || "",
                    clave_producto_servicio_sat: producto.clave_producto_servicio_sat || "",
                    clave_unidad_sat: producto.clave_unidad_sat || "H87",
                    marca: producto.marca || "",
                    medidas_cm: producto.medidas_cm || "0 x 0 x 0",
                    peso_kg: parseFloat(producto.peso_kg) || 0,
                    user_email: userEmail,
                    status: 'Pending'
                }
            });
            return {
                ok: true,
                sku,
                yaRegistrado: false,
                enValidacion: true,
                idValidacion: nuevo.id,
                data: producto,
                nota: `Producto analizado y enviado a validación. En la vista de validación puedes aprobarlo y subir el artículo a SAP.`
            };
        } catch (error) {
            console.error(`[clasificacion_sku] Error al guardar pendiente:`, error?.message ?? error);
            return {
                ok: true,
                sku,
                yaRegistrado: false,
                enValidacion: false,
                data: producto,
                nota: `Producto analizado, pero no se pudo enviar a validación: ${error?.message ?? error}`
            };
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