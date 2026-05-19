import { ContadoresController } from "../controllers/contadores.controller.js";
import { AzureAIService } from "./azureAI.service.js";
import { PdfService } from "./pdf.service.js";
import { AgentService } from "./db/agent.service.js";

export class AgentAIService {
    constructor(azureAIService = new AzureAIService(), contadoresController = new ContadoresController(), agentService = new AgentService()) {
        this.azureAI = azureAIService;
        this.pdfService = new PdfService();
        this.contadores = contadoresController;
        this.agentService = agentService;
    }



    /**
     * Extrae las intenciones del usuario a partir de su mensaje.
     * 
     * @param {*} requestData: {
     *   message: string,
     *   file?: { name: string, path: string },
     *   user: { name: string, email: string },
     *   history: [ { role: 'user' | 'assistant', content: string } ]
     * }
     */
async extraerIntenciones(requestData) {
        console.log("RequestData en extracción de intenciones:", requestData);
        const fechaActual = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
        
        const systemPrompt = `Eres un extractor de intenciones para un chatbot de contadores.
            Analiza el mensaje y detecta TODAS las intenciones presentes, aunque sean varias en un solo mensaje.
            para la intencion de analisis_contadores, si el usuario adjunta un archivo, asume que la intencioon es "analisis_contadores" y es un pdf para poder extraer el numero de hojas, y marca datos_completos: true, aunque no puedas acceder al archivo, para que el agente ejecute el servicio correspondiente.
            Responde ÚNICAMENTE con un JSON válido, sin Markdown, con este esquema:
            {
              "intenciones": [
                {
                  "tipo": "analisis_contadores" | "conversacion",
                  "datos_completos": true | false,
                  "datos": { ... },          // solo si datos_completos = true
                  "files": [ { "name": "string", "path": "string" } ], // solo si datos_completos = true y hay archivos
                  "dato_faltante": "..."      // solo si datos_completos = false, describe qué falta
                }
              ]
            }
        `;

        // NUEVO: Informamos al LLM si hay un archivo adjunto
        const infoArchivo = requestData.file 
            ? `\n[SISTEMA]: El usuario adjuntó el archivo: ${JSON.stringify(requestData.file)}` 
            : `\n[SISTEMA]: No se adjuntaron archivos.`;

        // Inyectamos la información del archivo en el prompt
        const mensaje = `Mensaje del usuario: "${requestData.message}"${infoArchivo}`;

        const respuesta = await this.azureAI.generarRespuesta(mensaje, systemPrompt);
        return JSON.parse(respuesta);
    }

    /**
     * Ejecuta la lógica de negocio basada en las intenciones detectadas.
     * 
     * @param {*} intenciones: Array de intenciones obtenidas en el paso anterior.
     * @returns Array de intenciones enriquecidas con el resultado de la ejecución.
     */
    async ejecutarServicios(intenciones, requestFile) {
        return Promise.all(
            intenciones.map(async (intencion) => {
                // Early return si no hay que procesar o es solo conversación
                if (!intencion.datos_completos || intencion.tipo === "conversacion") {
                    return { ...intencion, resultado: null };
                }

                if (intencion.tipo === "analisis_contadores") {
                    const archivo = requestFile || intencion.files?.[0];

                    // Validar si realmente hay archivos adjuntos
                    if (!archivo) {
                        return { ...intencion, resultado: null };
                    }

                    if (!archivo?.path) {
                        return { ...intencion, resultado: { error: "No se encontró la ruta del archivo PDF." } };
                    }

                    const numeroHojas = await this.pdfService.getPdfPageCount(archivo.path);
                    const analisisContadoresResultado = await ContadoresController.analizarContadores(archivo.path, archivo.name);
                    const resultado = { numeroHojas, analisisContadoresResultado };

                    // Manejo de todos los posibles escenarios de error
                    if (resultado.error) {
                        return { ...intencion, resultado: { error: resultado.error } };
                    } 
                    
                    if (resultado.numeroHojas === undefined) {
                        return { ...intencion, resultado: { error: "No se pudo determinar el número de hojas del archivo." } };
                    } 
                    
                    if (resultado.numeroHojas === 0) {
                        return { ...intencion, resultado: { error: "El archivo no contiene hojas válidas." } };
                    } 
                    
                    if (resultado.numeroHojas > 29) {
                        return { ...intencion, resultado: { error: "El archivo contiene demasiadas hojas para procesar." } };
                    } 
                    
                    // Escenario de éxito
                    return { ...intencion, resultado };
                }

                // Fallback por defecto si se añade otro tipo de intención en el futuro y no se maneja
                return { ...intencion, resultado: null };
            })
        );
    }

    /**
     * Sintetiza la respuesta final para el usuario basada en las acciones realizadas.
     * 
     * @param {*} requestData: {
     *   message: string,
     *   interacciones: [ { intencion: {}, resultado: {} } ],
     *   user: { name: string, email: string },
     *   history: [ { role: 'user' | 'assistant', content: string } ]
     * }
     */
    async procesarMensajeRespuesta(requestData) {
        // Manejo seguro de variables para evitar errores "undefined"
        const historialReciente = requestData.history ? requestData.history.slice(-4) : [];
        const interaccionesStr = requestData.interacciones && requestData.interacciones.length > 0 
            ? JSON.stringify(requestData.interacciones) 
            : "No se ejecutaron servicios adicionales.";
            console.log("Interacciones para la respuesta final:", interaccionesStr);
        const nombreUsuario = requestData.user && requestData.user.name ? requestData.user.name : "Usuario";
        const fechaActual = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

        // System Prompt enfocado ÚNICAMENTE en redactar la respuesta final
        const systemPrompt = `Eres el asistente virtual experto de un sistema de impresoras y contadores.
        Tu objetivo es generar la respuesta final para el usuario de forma clara, directa y profesional.
        
        REGLAS:
        - Tienes a tu disposición los "Resultados de las acciones" que el sistema ejecutó en segundo plano.
        - Utiliza estos resultados para responder a la petición del usuario.
        - Si en los resultados hay un "error" (por ejemplo: demasiadas hojas, archivo inválido), explícaselo al usuario de forma amable y ofrécele una alternativa si es posible.
        - Si en la intención se indica que falta información ("dato_faltante"), pídele al usuario exactamente lo que necesitas para continuar.
        - Mantén un tono conversacional. NO uses jerga de programación (no menciones "JSON", "intenciones", "servicios", "endpoints" ni "variables").
        - Responde directamente con el texto que leerá el usuario, sin estructuras JSON.
        - No respondas preguntas o frases de cultura general o temas en especificio que no sea conteo de hojas, conteo de impresiones o cualquier tema que no este relacionado con impresoras`;
        

        const mensaje = `
        Contexto de la conversación:
        - Nombre del usuario: ${nombreUsuario}
        - Historial reciente: ${JSON.stringify(historialReciente)}
        - Fecha y hora: ${fechaActual}
        
        Resultados de las acciones del sistema(siempre la informacion que te arrojen las interacciones son las verdad absolutas):
        ${interaccionesStr}

        Mensaje actual del usuario: "${requestData.message}"
        `;

        // Generar la respuesta en texto plano
        const respuestaTexto = await this.azureAI.generarRespuesta(mensaje, systemPrompt);
        
        const interacciones = Array.isArray(requestData.interacciones) ? requestData.interacciones : [];
        const analisisContadoresResultado = interacciones
            .map((item) => item?.resultado?.analisisContadoresResultado)
            .find(Boolean);

        if (analisisContadoresResultado) {
            return {
                respuesta: respuestaTexto,
                analisisContadores: analisisContadoresResultado
            };
        }

        return { 
            respuesta: respuestaTexto,
        }; 
    }

    /**
     * Orquestador principal del pipeline del agente.
     * Toma el input del cliente, coordina la extracción, ejecución y respuesta.
     * 
     * @param {*} requestData: Objeto original del frontend/router
     */
    async procesarMensajeCompleto(requestData) {
        try {
            const userEmail = requestData?.user?.email || 'system';

            try {
                await AgentService.saveMessageNoThread(
                    'agentegsa',
                    userEmail,
                    requestData?.message || '',
                    'user'
                );
            } catch (logError) {
                console.error('Error registrando mensaje de usuario:', logError);
            }

            // 1. Extraer intenciones
            const extraccionPayload = await this.extraerIntenciones(requestData);
            const intenciones = extraccionPayload.intenciones || [];

            // 2. Ejecutar lógica de negocio
            const interacciones = await this.ejecutarServicios(intenciones, requestData.file);

            // 3. Preparar datos para la respuesta final
            const datosParaRespuesta = {
                ...requestData,           
                interacciones: interacciones 
            };

            // 4. Generar respuesta
            const respuestaFinal = await this.procesarMensajeRespuesta(datosParaRespuesta);

            const tokensInput = requestData?.message?.length || 0;
            const tokensOutput = respuestaFinal?.respuesta?.length || 0;
            const payload = JSON.stringify({
                message: requestData?.message || '',
                interacciones,
                respuesta: respuestaFinal?.respuesta || ''
            });

            try {
                await AgentService.AgentActions(
                    'agentegsa',
                    userEmail,
                    'chat',
                    'procesarMensajeCompleto',
                    tokensInput,
                    tokensOutput,
                    payload
                );
            } catch (logError) {
                console.error('Error registrando accion del agente:', logError);
            }

            try {
                await AgentService.saveMessageNoThread(
                    'agentegsa',
                    userEmail,
                    respuestaFinal?.respuesta || '',
                    'agent'
                );
            } catch (logError) {
                console.error('Error registrando mensaje del agente:', logError);
            }

            return respuestaFinal;

        } catch (error) {
            console.error("Error en el pipeline del Agente IA:", error);
            try {
                const userEmail = requestData?.user?.email || 'system';
                await AgentService.AgentActions(
                    'agentegsa',
                    userEmail,
                    'error',
                    'procesarMensajeCompleto',
                    requestData?.message?.length || 0,
                    0,
                    JSON.stringify({ message: requestData?.message || '' }),
                    error?.message || String(error)
                );
            } catch (logError) {
                console.error('Error registrando accion de error del agente:', logError);
            }
            return { 
                respuesta: "Lo siento, tuve un problema técnico al procesar tu solicitud. ¿Podrías intentarlo de nuevo?" 
            };
        }
    }
}