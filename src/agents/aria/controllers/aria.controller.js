import { LLMService } from "../services/LLM.js";

// ID del bot ARIA en Dataverse
const ARIA_BOT_ID = "e0cee565-4bdd-4c0a-b851-1600d9306ed3";

export class AriaController {

    // --- 1. MÉTODO EXISTENTE (Para análisis de fechas con LLM) ---
    static async analyzeDate(req, res) {
        try {
            const { date } = req.body;
            // Validar entrada
            if (!date) return res.status(400).json({ error: 'Date is required' });

            const result = await LLMService.analyzeDate(date);
            res.json({ result });
        } catch (error) {
            console.error('Error analyzing data:', error);
            res.status(500).json({ error: 'Error analyzing data' });
        }
    }

    // --- 2. MÉTODO PRINCIPAL: DASHBOARD DE ARIA ---
    static async getDashboardStats(req, res) {
        try {
            console.log("🔵 Iniciando carga de Dashboard para ARIA...");

            // Obtener parámetro de días para filtrar (opcional)
            const daysParam = req.query.days ? parseInt(req.query.days) : null;
            console.log(`📅 Filtro de días: ${daysParam || 'Todos'}`);

            // A. CONFIGURACIÓN Y CREDENCIALES
            // (Idealmente mueve estos valores a tu archivo .env en producción)
            const tenantId = "267e7400-d5af-4805-bce9-1e4247c0c3a7";
            const clientId = "6840a6b2-7154-4c5d-8081-003edd0da715";
            const clientSecret = process.env.DYNAMIC_SECRET; // ¡Asegúrate de que esto exista en tu .env!
            const scope = "https://ccad.api.crm.dynamics.com/.default";

            // B. OBTENER TOKEN DE ACCESO (OAUTH2)
            const tokenParams = new URLSearchParams();
            tokenParams.append('client_id', clientId);
            tokenParams.append('scope', scope);
            tokenParams.append('client_secret', clientSecret);
            tokenParams.append('grant_type', 'client_credentials');

            const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
                method: 'POST',
                body: tokenParams
            });

            if (!tokenResponse.ok) throw new Error("Fallo al obtener token de Azure: " + await tokenResponse.text());
            const { access_token } = await tokenResponse.json();

            // C. CONSTRUIR FILTRO DE DATAVERSE
            let dataverseFilter = `_bot_conversationtranscriptid_value eq '${ARIA_BOT_ID}'`;

            // Agregar filtro de fecha si se especifica
            if (daysParam && daysParam > 0) {
                const cutoffDate = new Date();
                cutoffDate.setDate(cutoffDate.getDate() - daysParam);
                const isoDate = cutoffDate.toISOString();
                dataverseFilter += ` and createdon ge ${isoDate}`;
                console.log(`📅 Filtrando desde: ${isoDate}`);
            }

            const dataverseUrl = `https://ccad.api.crm.dynamics.com/api/data/v9.2/conversationtranscripts?$filter=${encodeURIComponent(dataverseFilter)}&$top=5000&$orderby=createdon desc`;

            const dataResponse = await fetch(dataverseUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'odata.include-annotations="*"'
                }
            });

            if (!dataResponse.ok) throw new Error("Error en Dataverse: " + await dataResponse.text());

            const json = await dataResponse.json();
            const ariaTranscripts = json.value || [];

            console.log(`📊 Stats: ${ariaTranscripts.length} registros de ARIA obtenidos ${daysParam ? `(últimos ${daysParam} días)` : '(todos)'}`);

            // E. PROCESAMIENTO DE MÉTRICAS
            let uniqueUsers = new Set();
            let resolvedCount = 0;
            let totalMessages = 0;
            let totalDurationMs = 0; // Para el KPI de Tiempo
            let sessionsWithDuration = 0; // Contador de sesiones con duración válida
            let topicsMap = {};
            let statusMap = { "Resuelto": 0, "Tema Finalizado": 0, "Error": 0, "En Proceso": 0 };
            let gapMap = {}; // Para temas donde el bot falló o se escaló

            // Mapeamos TODAS las transcripciones para sacar métricas globales
            const processedItems = ariaTranscripts.map(item => {
                // Parsear el contenido JSON
                let content = {};
                try {
                    content = item.content ? JSON.parse(item.content) : { activities: [] };
                } catch (e) {
                    content = { activities: [] };
                }

                const activities = content.activities || [];

                // --- KPI: Mensajes del Usuario ---
                const userMessages = activities.filter(a => a.type === 'message' && a.from?.role === 1).length;
                totalMessages += userMessages;

                // --- KPI: Duración de Sesión (mejorado) ---
                if (activities.length > 1) {
                    // Filtrar solo actividades con timestamps válidos
                    const validActivities = activities.filter(a => a.timestamp && !isNaN(new Date(a.timestamp).getTime()));

                    if (validActivities.length > 1) {
                        const sortedActivities = validActivities.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                        const start = new Date(sortedActivities[0].timestamp);
                        const end = new Date(sortedActivities[sortedActivities.length - 1].timestamp);
                        const duration = end - start;

                        // Solo contar duraciones razonables (entre 1 segundo y 2 horas)
                        if (duration > 1000 && duration < 7200000) {
                            totalDurationMs += duration;
                            sessionsWithDuration++;
                        }
                    }
                }

                // --- 1. Extraer Usuario ---
                const userActivity = activities.find(a => a.from && a.from.role === 1);
                const rawName = userActivity?.from?.name || "Usuario Anónimo";
                const cleanName = rawName.includes(',') ? rawName.split(',').reverse().join(' ').trim() : rawName;

                const userId = userActivity?.from?.aadObjectId || userActivity?.from?.id;
                if (userId) uniqueUsers.add(userId);

                // --- 2. Extraer Resultado (Outcome) ---
                const sessionTrace = activities.find(a => a.valueType === "SessionInfo");
                const outcome = sessionTrace?.value?.outcome || "Unknown";

                if (outcome === "Resolved") resolvedCount++;

                // --- 3. Extraer Consulta ---
                const firstUserMessage = activities.find(a => a.type === 'message' && a.from.role === 1);
                const queryText = firstUserMessage?.text || "Inicio de conversación";

                // --- 4. Calcular Estado Visual ---
                let statusUI = "En Proceso";
                if (outcome === "Resolved") statusUI = "Resuelto";
                else if (outcome === "Abandoned") statusUI = "Tema Finalizado";
                else if (outcome === "Error") statusUI = "Error";

                // --- 5. Calcular Tiempo Relativo (Hace X min) ---
                const createdDate = new Date(item.createdon);
                const diffMs = new Date() - createdDate;
                const diffMins = Math.floor(diffMs / 60000);
                let timeAgo = diffMins < 60 ? `Hace ${diffMins} min` : `Hace ${Math.floor(diffMins / 60)} horas`;

                // --- 6. Detectar Tema (Lógica Específica) ---
                const lowerText = queryText.toLowerCase();
                let topic = "Otros";

                if (lowerText.includes("reserva") && (lowerText.includes("oficina") || lowerText.includes("sala"))) topic = "Reservar Oficina";
                else if (lowerText.includes("check") || lowerText.includes("llegada") || lowerText.includes("entrada")) topic = "Check-in Oficina";
                else if (lowerText.includes("carta") || lowerText.includes("laboral") || lowerText.includes("constancia")) topic = "Cartas Laborales";
                else if (lowerText.includes("días") || lowerText.includes("dias") || lowerText.includes("saldo") || lowerText.includes("cuánto")) topic = "Días de Vacaciones";
                else if (lowerText.includes("vacac")) topic = "Solicitar Vacaciones"; // Fallback para vacaciones si no es saldo

                // Contar tema
                topicsMap[topic] = (topicsMap[topic] || 0) + 1;

                // Contar estatus global
                if (statusMap[statusUI] !== undefined) statusMap[statusUI]++;
                else statusMap["En Proceso"]++;

                // Contar gap de conocimiento
                if (outcome === "Abandoned" || outcome === "Error") {
                    gapMap[topic] = (gapMap[topic] || 0) + 1;
                }

                return {
                    id: item.conversationtranscriptid,
                    usuario: cleanName,
                    avatar: cleanName.charAt(0).toUpperCase(),
                    consulta: `"${queryText}"`,
                    estado: statusUI,
                    tiempo: timeAgo
                };
            });

            // F. CÁLCULO DE TOTALES (KPIs)
            const totalSessions = ariaTranscripts.length;
            const uniqueUsersCount = uniqueUsers.size;

            const avgMessagesVal = totalSessions > 0 ? (totalMessages / totalSessions).toFixed(1) : "0";

            // KPI Duración Promedio (en minutos) - usar solo sesiones con duración válida
            const avgDurationMs = sessionsWithDuration > 0 ? (totalDurationMs / sessionsWithDuration) : 0;
            // const avgDurationMins = avgDurationMs > 0 ? (avgDurationMs / 60000).toFixed(1) + " min" : "N/A"; // Unused in this scope but logic is here

            const topTopic = Object.keys(topicsMap).length > 0
                ? Object.keys(topicsMap).reduce((a, b) => topicsMap[a] > topicsMap[b] ? a : b)
                : "General";

            const topGap = Object.keys(gapMap).length > 0
                ? Object.keys(gapMap).reduce((a, b) => gapMap[a] > gapMap[b] ? a : b)
                : "Ninguno";

            // H. CALCULAR TASA DE RESOLUCIÓN
            const resolutionRate = totalSessions > 0
                ? Math.round((resolvedCount / totalSessions) * 100)
                : 0;

            // I. CALCULAR TENDENCIA POR DÍA (últimos 7 días)
            const trendMap = {};
            const today = new Date();

            // Inicializar últimos 7 días con 0
            for (let i = 6; i >= 0; i--) {
                const date = new Date(today);
                date.setDate(date.getDate() - i);
                const key = date.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' });
                trendMap[key] = 0;
            }

            // Contar sesiones por día
            ariaTranscripts.forEach(item => {
                const createdDate = new Date(item.createdon);
                const diffDays = Math.floor((today - createdDate) / (1000 * 60 * 60 * 24));

                if (diffDays < 7) {
                    const key = createdDate.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric' });
                    if (trendMap[key] !== undefined) {
                        trendMap[key]++;
                    }
                }
            });

            const trendData = Object.entries(trendMap).map(([date, sessions]) => ({
                date,
                sessions
            }));

            // J. RESPUESTA AL CLIENTE
            res.json({
                kpis: {
                    total_sesiones: totalSessions.toLocaleString(),
                    usuarios_unicos: uniqueUsersCount,
                    tasa_resolucion: resolutionRate + "%",
                    tema_frecuente: topTopic,
                    promedio_mensajes: avgMessagesVal,
                    gap_conocimiento: topGap
                },
                charts: {
                    temas: Object.entries(topicsMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
                    estatus: Object.entries(statusMap).map(([name, value]) => ({ name, value })).filter(x => x.value > 0),
                    tendencia: trendData
                },
                actividad_reciente: processedItems.slice(0, 10) // Enviamos solo las 10 últimas
            });

        } catch (error) {
            console.error('❌ Error crítico en Dashboard:', error);
            res.status(500).json({
                error: error.message,
                kpis: {
                    total_sesiones: "0",
                    usuarios_unicos: 0,
                    duracion_promedio: "0 min",
                    tema_frecuente: "-",
                    promedio_mensajes: "0",
                    gap_conocimiento: "-"
                },
                actividad_reciente: []
            });
        }
    }

    // --- 3. MÉTODO: HISTORIAL COMPLETO ---
    static async getHistory(req, res) {
        try {
            console.log("🔵 Obteniendo historial completo para ARIA...");

            // A. CONFIGURACIÓN Y CREDENCIALES (Reutilizar lógica - idealmente refactorizar)
            const tenantId = "267e7400-d5af-4805-bce9-1e4247c0c3a7";
            const clientId = "6840a6b2-7154-4c5d-8081-003edd0da715";
            const clientSecret = process.env.DYNAMIC_SECRET;
            const scope = "https://ccad.api.crm.dynamics.com/.default";

            const tokenParams = new URLSearchParams();
            tokenParams.append('client_id', clientId);
            tokenParams.append('scope', scope);
            tokenParams.append('client_secret', clientSecret);
            tokenParams.append('grant_type', 'client_credentials');

            const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
                method: 'POST',
                body: tokenParams
            });

            if (!tokenResponse.ok) throw new Error("Fallo al obtener token de Azure");
            const { access_token } = await tokenResponse.json();

            // Consulta optimizada con filtro por BOT ID
            const dataverseUrl = `https://ccad.api.crm.dynamics.com/api/data/v9.2/conversationtranscripts?$filter=_bot_conversationtranscriptid_value eq '${ARIA_BOT_ID}'&$top=5000&$orderby=createdon desc`;

            const dataResponse = await fetch(dataverseUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'odata.include-annotations="*"'
                }
            });

            if (!dataResponse.ok) throw new Error("Error en Dataverse");

            const json = await dataResponse.json();
            const ariaTranscripts = json.value || [];

            const fullHistory = ariaTranscripts.map(item => {
                let content = {};
                try {
                    content = item.content ? JSON.parse(item.content) : { activities: [] };
                } catch (e) {
                    content = { activities: [] };
                }

                const activities = content.activities || [];
                const userActivity = activities.find(a => a.from && a.from.role === 1);
                const rawName = userActivity?.from?.name || "Usuario Anónimo";
                const cleanName = rawName.includes(',') ? rawName.split(',').reverse().join(' ').trim() : rawName;

                const sessionTrace = activities.find(a => a.valueType === "SessionInfo");
                const outcome = sessionTrace?.value?.outcome || "Unknown";

                const firstUserMessage = activities.find(a => a.type === 'message' && a.from.role === 1);
                const queryText = firstUserMessage?.text || "Inicio de conversación";

                let statusUI = "En Proceso";
                if (outcome === "Resolved") statusUI = "Resuelto";
                else if (outcome === "Abandoned") statusUI = "Tema Finalizado";
                else if (outcome === "Error") statusUI = "Error";

                const createdDate = new Date(item.createdon);
                const diffMs = new Date() - createdDate;
                const diffMins = Math.floor(diffMs / 60000);
                let timeAgo = diffMins < 60 ? `Hace ${diffMins} min` : `Hace ${Math.floor(diffMins / 60)} horas`;
                // También mostramos la fecha real para el historial
                const dateStr = createdDate.toLocaleDateString() + ' ' + createdDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                return {
                    id: item.conversationtranscriptid,
                    usuario: cleanName,
                    avatar: cleanName.charAt(0).toUpperCase(),
                    consulta: `"${queryText}"`,
                    estado: statusUI,
                    tiempo: timeAgo,
                    fecha_real: dateStr // Campo extra útil para historial
                };
            });

            res.json(fullHistory);

        } catch (error) {
            console.error('❌ Error en Historial:', error);
            res.status(500).json([]);
        }
    }

    // --- 4. MÉTODO: DETALLE DEL CHAT DE UNA SESIÓN ---
    static async getChatDetail(req, res) {
        try {
            const { sessionId } = req.params;

            if (!sessionId) {
                return res.status(400).json({ error: 'Session ID is required' });
            }

            console.log(`🔵 Obteniendo detalle del chat para sesión: ${sessionId}`);

            // A. CONFIGURACIÓN Y CREDENCIALES
            const tenantId = "267e7400-d5af-4805-bce9-1e4247c0c3a7";
            const clientId = "6840a6b2-7154-4c5d-8081-003edd0da715";
            const clientSecret = process.env.DYNAMIC_SECRET;
            const scope = "https://ccad.api.crm.dynamics.com/.default";

            const tokenParams = new URLSearchParams();
            tokenParams.append('client_id', clientId);
            tokenParams.append('scope', scope);
            tokenParams.append('client_secret', clientSecret);
            tokenParams.append('grant_type', 'client_credentials');

            const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
                method: 'POST',
                body: tokenParams
            });

            if (!tokenResponse.ok) throw new Error("Fallo al obtener token de Azure");
            const { access_token } = await tokenResponse.json();

            // B. OBTENER LA CONVERSACIÓN ESPECÍFICA
            const dataverseUrl = `https://ccad.api.crm.dynamics.com/api/data/v9.2/conversationtranscripts(${sessionId})`;

            const dataResponse = await fetch(dataverseUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'odata.include-annotations="*"'
                }
            });

            if (!dataResponse.ok) {
                const errorText = await dataResponse.text();
                throw new Error("Error en Dataverse: " + errorText);
            }

            const item = await dataResponse.json();

            // C. PARSEAR EL CONTENIDO
            let content = {};
            try {
                content = item.content ? JSON.parse(item.content) : { activities: [] };
            } catch (e) {
                content = { activities: [] };
            }

            const activities = content.activities || [];

            // D. EXTRAER INFORMACIÓN DEL USUARIO
            const userActivity = activities.find(a => a.from && a.from.role === 1);
            const rawName = userActivity?.from?.name || "Usuario Anónimo";
            const cleanName = rawName.includes(',') ? rawName.split(',').reverse().join(' ').trim() : rawName;

            // E. FILTRAR Y FORMATEAR MENSAJES
            const messages = activities
                .filter(a => a.type === 'message' && a.text)
                .map(a => {
                    const isUser = a.from?.role === 1;
                    const timestamp = new Date(a.timestamp);

                    return {
                        id: a.id,
                        role: isUser ? 'user' : 'bot',
                        text: a.text,
                        timestamp: timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        fullTimestamp: a.timestamp
                    };
                })
                .sort((a, b) => new Date(a.fullTimestamp) - new Date(b.fullTimestamp));

            // F. INFORMACIÓN DE LA SESIÓN
            const createdDate = new Date(item.createdon);
            const sessionInfo = {
                id: item.conversationtranscriptid,
                usuario: cleanName,
                fecha: createdDate.toLocaleDateString() + ' ' + createdDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                totalMensajes: messages.length
            };

            res.json({
                session: sessionInfo,
                messages: messages
            });

        } catch (error) {
            console.error('❌ Error al obtener detalle del chat:', error);
            res.status(500).json({ error: error.message });
        }
    }

    // --- 5. OBTENER USUARIOS DEL SISTEMA (SYSTEMUSER) ---
    static async getSystemUsers(req, res) {
        try {
            console.log("👥 Obteniendo usuarios del sistema desde Dataverse...");

            // A. CONFIGURACIÓN (reutilizamos las mismas credenciales)
            const tenantId = "267e7400-d5af-4805-bce9-1e4247c0c3a7";
            const clientId = "6840a6b2-7154-4c5d-8081-003edd0da715";
            const clientSecret = process.env.DYNAMIC_SECRET;
            const scope = "https://ccad.api.crm.dynamics.com/.default";

            // B. OBTENER TOKEN
            const tokenParams = new URLSearchParams();
            tokenParams.append('client_id', clientId);
            tokenParams.append('scope', scope);
            tokenParams.append('client_secret', clientSecret);
            tokenParams.append('grant_type', 'client_credentials');

            const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
                method: 'POST',
                body: tokenParams
            });

            if (!tokenResponse.ok) throw new Error("Fallo al obtener token: " + await tokenResponse.text());
            const { access_token } = await tokenResponse.json();

            // C. CONSULTAR SYSTEMUSER
            // Filtramos usuarios activos con email @compucad.com.mx
            const dataverseUrl = `https://ccad.api.crm.dynamics.com/api/data/v9.2/systemusers?$select=systemuserid,fullname,internalemailaddress,title,_businessunitid_value&$filter=isdisabled eq false and internalemailaddress ne null and endswith(internalemailaddress,'@compucad.com.mx')&$orderby=fullname asc&$top=500`;

            const dataResponse = await fetch(dataverseUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'odata.include-annotations="*"'
                }
            });

            if (!dataResponse.ok) throw new Error("Error en Dataverse: " + await dataResponse.text());

            const json = await dataResponse.json();
            const users = json.value || [];

            console.log(`✅ Se obtuvieron ${users.length} usuarios @compucad.com.mx`);

            // D. MAPEAR A FORMATO LIMPIO
            const mappedUsers = users
                .filter(u => u.internalemailaddress && u.internalemailaddress.endsWith('@compucad.com.mx'))
                .map(user => ({
                    id: user.systemuserid,
                    displayName: user.fullname || 'Sin nombre',
                    email: user.internalemailaddress,
                    title: user.title || null,
                    businessUnit: user['_businessunitid_value@OData.Community.Display.V1.FormattedValue'] || 'Sin unidad'
                }));

            // E. AGRUPAR POR UNIDAD DE NEGOCIO
            const byBusinessUnit = {};
            mappedUsers.forEach(user => {
                const unit = user.businessUnit || 'Sin unidad';
                if (!byBusinessUnit[unit]) {
                    byBusinessUnit[unit] = [];
                }
                byBusinessUnit[unit].push(user);
            });

            // Ordenar unidades alfabéticamente
            const sortedUnits = Object.keys(byBusinessUnit).sort();

            res.json({
                total: mappedUsers.length,
                users: mappedUsers,
                businessUnits: sortedUnits,
                byBusinessUnit: byBusinessUnit
            });

        } catch (error) {
            console.error('❌ Error al obtener usuarios:', error);
            res.status(500).json({ error: error.message });
        }
    }

    // --- 6. GESTIÓN DE ARCHIVOS (MIGRADO A SHAREPOINT) ---
    // IDs obtenidos mediante script de prueba (Sub-sitio TD)
    static DRIVE_ID = "b!bSuHMmR-nUmBip_FT67_ODpp-ZUHAWZFq91jHGiCJADUKY-CuWOtQ5coNu0a6zDL";
    static SHAREPOINT_FOLDER = "/Agentes/Aria";

    // Helper para obtener token de Graph API
    static async _getGraphToken() {
        const tenantId = "267e7400-d5af-4805-bce9-1e4247c0c3a7";
        const clientId = "6840a6b2-7154-4c5d-8081-003edd0da715";
        const clientSecret = process.env.DYNAMIC_SECRET;
        const scope = "https://graph.microsoft.com/.default";

        const tokenParams = new URLSearchParams();
        tokenParams.append('client_id', clientId);
        tokenParams.append('scope', scope);
        tokenParams.append('client_secret', clientSecret);
        tokenParams.append('grant_type', 'client_credentials');

        const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
            method: 'POST', body: tokenParams
        });

        if (!tokenResponse.ok) throw new Error("Error obteniendo token Graph: " + await tokenResponse.text());
        const { access_token } = await tokenResponse.json();
        return access_token;
    }

    /**
     * Sube archivo a SharePoint y devuelve URL del Proxy
     */
    static async uploadFile(req, res) {
        try {
            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

            const token = await AriaController._getGraphToken();
            const originalName = req.file.originalname;
            // Sanitizar nombre y agregar timestamp para evitar colisiones
            const safeName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
            const fileName = `${Date.now()}_${safeName}`;

            console.log(`📤 Subiendo archivo a SharePoint: ${fileName}`);

            // URL: PUT /drives/{drive-id}/root:/{path}/{filename}:/content
            const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${AriaController.DRIVE_ID}/root:${AriaController.SHAREPOINT_FOLDER}/${fileName}:/content`;

            const uploadResponse = await fetch(uploadUrl, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': req.file.mimetype
                },
                body: req.file.buffer
            });

            if (!uploadResponse.ok) {
                throw new Error("Error subiendo a SharePoint: " + await uploadResponse.text());
            }

            const json = await uploadResponse.json();
            const itemId = json.id; // ID del archivo en SharePoint

            console.log(`✅ Archivo subido exitosamente. ID: ${itemId}`);

            // Construir URL pública del proxy (usando ID de SharePoint)
            const baseUrl = req.protocol + '://' + req.get('host');
            const publicUrl = `${baseUrl}/agente/aria/file/${itemId}`;

            res.json({ url: publicUrl, id: itemId });

        } catch (error) {
            console.error('SharePoint Upload error:', error);
            res.status(500).json({ error: 'Error uploading file to SharePoint' });
        }
    }

    /**
     * Endpoint Proxy: Descarga contenido desde SharePoint mediante Graph API
     * Permite que las imágenes sean accesibles sin que el cliente tenga token de Graph.
     */
    static async getFile(req, res) {
        try {
            const { id } = req.params;
            if (!id) return res.status(400).send('ID required');

            const token = await AriaController._getGraphToken();

            // URL: GET /drives/{drive-id}/items/{item-id}/content
            const downloadUrl = `https://graph.microsoft.com/v1.0/drives/${AriaController.DRIVE_ID}/items/${id}/content`;

            const fileResponse = await fetch(downloadUrl, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!fileResponse.ok) {
                console.error(`❌ SharePoint Download Error: ${fileResponse.status}`);
                return res.status(404).send('File not found in SharePoint');
            }

            // Intentar inferir Content-Type o usar el de la respuesta si Graph lo devuelve
            const contentType = fileResponse.headers.get('content-type') || 'application/octet-stream';

            res.setHeader('Content-Type', contentType);
            // Cache agresivo para mejorar rendimiento de imágenes
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

            // Streaming directo de la respuesta de fetch a express
            // (Node 18+ nativo fetch devuelve ReadableStream en body, pero express necesita node stream)
            const arrayBuffer = await fileResponse.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            res.setHeader('Content-Length', buffer.length);
            res.send(buffer);

        } catch (error) {
            console.error('SharePoint Download error:', error);
            res.status(500).send('Error retrieving file from SharePoint');
        }
    }

}