import axios from 'axios';
import https from 'https';

// Ignorar errores de certificados autofirmados (común en SAP B1 Service Layer)
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

class Sesion {
    constructor(odataMetadata, sessionId, version, sessionTimeout) {
        this["@odata.metadata"] = odataMetadata;
        this.SessionId = sessionId;
        this.Version = version;
        this.SessionTimeout = sessionTimeout;
    }
}

export class SapService {

    // ==========================================
    // AUTENTICACIÓN Y MÉTODOS BASE
    // ==========================================

    static async login() {
        try {
            const response = await axios.post(`${process.env.SAP_BASE_URL}Login`, {
                UserName: process.env.SAP_USERNAME,
                Password: process.env.SAP_PASSWORD,
                CompanyDB: process.env.SAP_COMPANYDB
            }, { httpsAgent });

            const data = response.data;
            const session = new Sesion(data["@odata.metadata"], data.SessionId, data.Version, data.SessionTimeout);
            return session;
        } catch (error) {
            console.error('Error al iniciar sesión en SAP:');
            throw error;
        }
    }

    static async getPurchaseOrdersByID(session, purchaseOrderID) {
        try {
            const response = await axios.get(`${process.env.SAP_BASE_URL}PurchaseOrders(${purchaseOrderID})`, {
                headers: { 'Cookie': `B1SESSION=${session.SessionId}` },
                httpsAgent
            });
            return response.data;
        } catch (error) {
            console.error('Error al obtener las órdenes de compra:');
            throw error;
        }
    }

    static async getUserByID(session, userID) {
        try {
            const response = await axios.get(`${process.env.SAP_BASE_URL}Users(${userID})`, {
                headers: { 'Cookie': `B1SESSION=${session.SessionId}` },
                httpsAgent
            });
            return response.data;
        } catch (error) {
            console.error('Error al obtener el usuario:');
            throw error;
        }
    }

    static async getUserByPurchaseOrder(purchaseOrderID) {
        const session = await this.login();
        const purchaseOrder = await this.getPurchaseOrdersByID(session, purchaseOrderID);
        const user = await this.getUserByID(session, purchaseOrder.UserSign);
        return { email: user.eMail };
    }

    // ==========================================
    // RASTREO UNIVERSAL (COMPRAS Y VENTAS)
    // ==========================================

    static async ensureSQLQueryRastreoUniversal(session) {
        // V8: parámetros nombrados ÚNICOS por rama (el Service Layer no permite reusar :guia)
        const SQL_CODE = 'RastreoUniversalV8';

        // Notas Service Layer:
        //  - Parámetros nombrados (:nombre), NO la sintaxis [%0] del Query Manager.
        //  - No admite derived tables (subconsulta en FROM): el UNION ALL va a nivel superior.
        //  - No permite reusar el mismo parámetro: cada rama usa su propio nombre (:guiaCompra / :guiaVenta).
        const SQL_TEXT = `SELECT 'COMPRA' AS "Tipo", T0."DocNum", T0."CardName", T1."U_Guia", T1."U_Via", T1."U_EstComprobante", T1."U_U_Coment_Log" FROM "OPOR" T0 INNER JOIN "POR1" T1 ON T0."DocEntry" = T1."DocEntry" WHERE T1."U_Guia" LIKE :guiaCompra UNION ALL SELECT 'VENTA' AS "Tipo", T0."DocNum", T0."CardName", T1."U_Guia", T1."U_Via", T1."U_EstComprobante", T1."U_U_Coment_Log" FROM "ODLN" T0 INNER JOIN "DLN1" T1 ON T0."DocEntry" = T1."DocEntry" WHERE T1."U_Guia" LIKE :guiaVenta`;

        const headers = { 'Cookie': `B1SESSION=${session.SessionId}` };

        try {
            await axios.get(`${process.env.SAP_BASE_URL}SQLQueries('${SQL_CODE}')`, { headers, httpsAgent });
            await axios.patch(`${process.env.SAP_BASE_URL}SQLQueries('${SQL_CODE}')`, {
                SqlText: SQL_TEXT
            }, { headers, httpsAgent });
            console.log(`SQL Query '${SQL_CODE}' actualizado en SAP.`);
        } catch (getErr) {
            if (getErr.response?.status !== 404) {
                console.error(`Error al verificar/actualizar SQL Query '${SQL_CODE}':`, JSON.stringify(getErr.response?.data ?? getErr.message));
                return;
            }
            try {
                await axios.post(`${process.env.SAP_BASE_URL}SQLQueries`, {
                    SqlCode: SQL_CODE,
                    SqlName: 'Buscar Guia Universal V8',
                    SqlText: SQL_TEXT
                }, { headers, httpsAgent });
                console.log(`SQL Query '${SQL_CODE}' creado con éxito en SAP.`);
            } catch (createErr) {
                console.error(`Error al crear SQL Query '${SQL_CODE}':`, JSON.stringify(createErr.response?.data ?? createErr.message));
            }
        }
    }

    static async buscarGuiaUniversalPorSQLQuery(session, trackingNumber) {
        try {
            console.log(`Buscando guía en SAP: ${trackingNumber}`);

            // El Service Layer parsea ParamList como query-string y hace percent-decoding,
            // así que el valor debe ir URL-encodeado. El comodín % crudo rompe con "Parameter error"
            // (código 704); encodeURIComponent lo convierte a %25 y respeta las comillas del literal.
            const valorLike = encodeURIComponent(`'%${trackingNumber}%'`);

            const response = await axios.post(
                `${process.env.SAP_BASE_URL}SQLQueries('RastreoUniversalV8')/List`,
                { ParamList: `guiaCompra=${valorLike}&guiaVenta=${valorLike}` },
                {
                    headers: { 'Cookie': `B1SESSION=${session.SessionId}` },
                    httpsAgent
                }
            );

            const data = response.data;

            if (!data.value || data.value.length === 0) {
                console.log(`❌ No encontrada en SAP: ${trackingNumber}`);
                return { success: false, guia: trackingNumber, message: 'No encontrada en SAP' };
            }

            const rastreo = data.value[0];
            console.log(`✅ Guía encontrada! Tipo: ${rastreo.Tipo} | Folio: ${rastreo.DocNum} | Estatus: ${rastreo.U_EstComprobante}`);

            return {
                success: true,
                tipoOperacion: rastreo.Tipo, 
                guia: trackingNumber,
                folioDocumento: rastreo.DocNum ?? null,
                clienteOProveedor: rastreo.CardName ?? null,
                paqueteria: rastreo.U_Via ?? null,
                estatus: rastreo.U_EstComprobante ?? null,
                comentariosRPA: rastreo.U_U_Coment_Log ?? null,
            };
        } catch (error) {
            const detalle = error.response?.data ?? error.message;
            console.error(`Error al buscar guía ${trackingNumber} en SAP:`, JSON.stringify(detalle));
            throw error;
        }
    }

    /**
     * Método orquestador para consultar una sola guía.
     */
    static async getTrackingInfo(trackingNumber) {
        const session = await this.login();
        await this.ensureSQLQueryRastreoUniversal(session).catch(e => console.error('Fallo al validar SQL Query:', e.message));
        return this.buscarGuiaUniversalPorSQLQuery(session, trackingNumber);
    }

    /**
     * Método orquestador para consultar un arreglo de guías reciclando la misma sesión.
     */
    static async getTrackingInfoBatch(trackingNumbers) {
        if (!Array.isArray(trackingNumbers) || trackingNumbers.length === 0) {
            return [];
        }

        console.log(`Iniciando consulta batch SAP para ${trackingNumbers.length} guías...`);
        
        const session = await this.login();
        await this.ensureSQLQueryRastreoUniversal(session).catch(e => console.error('Fallo al validar SQL Query:', e.message));
        
        const resultados = [];

        for (const guia of trackingNumbers) {
            try {
                const resultado = await this.buscarGuiaUniversalPorSQLQuery(session, guia);
                resultados.push(resultado);
            } catch (error) {
                resultados.push({ success: false, guia, message: error.message });
            }
        }

        return resultados;
    }
}