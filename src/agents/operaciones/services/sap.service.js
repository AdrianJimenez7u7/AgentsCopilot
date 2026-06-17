import axios from 'axios';
import https from 'https';

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
                headers: {
                    'Cookie': `B1SESSION=${session.SessionId}`
                },
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
                headers: {
                    'Cookie': `B1SESSION=${session.SessionId}`
                },
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
    // NUEVOS MÉTODOS PARA RASTREO DE ENVÍOS
    // ==========================================

    static async getDeliveryByTrackingNumber(session, trackingNumber) {
        try {
            // Filtramos por U_Guia o TrackingNumber y seleccionamos solo lo necesario
            const query = `$filter=U_Guia eq '${trackingNumber}' or TrackingNumber eq '${trackingNumber}'&$select=DocEntry,DocNum,CardName,DocumentLines`;
            const response = await axios.get(`${process.env.SAP_BASE_URL}DeliveryNotes?${query}`, {
                headers: {
                    'Cookie': `B1SESSION=${session.SessionId}`
                },
                httpsAgent
            });

            return response.data;
        } catch (error) {
            console.error('Error al buscar la entrega por número de guía:');
            throw error;
        }
    }

    static async getPickListByID(session, pickListID) {
        try {
            // Extraemos solo el nombre del colaborador y la paquetería
            const query = `$select=Name,U_Paqueteria`;
            const response = await axios.get(`${process.env.SAP_BASE_URL}PickLists(${pickListID})?${query}`, {
                headers: {
                    'Cookie': `B1SESSION=${session.SessionId}`
                },
                httpsAgent
            });

            return response.data;
        } catch (error) {
            console.error('Error al obtener la lista de picking:');
            throw error;
        }
    }

    static async getTrackingInfo(trackingNumber) {
        try {
            const session = await this.login();

            // 1. Buscamos la entrega
            const deliveryData = await this.getDeliveryByTrackingNumber(session, trackingNumber);

            if (!deliveryData.value || deliveryData.value.length === 0) {
                return { success: false, message: `No se encontró entrega para la guía ${trackingNumber}` };
            }

            const delivery = deliveryData.value[0];
            const cliente = delivery.CardName;

            // Extraemos el ID de Picking de la primera línea
            const primeraLinea = delivery.DocumentLines && delivery.DocumentLines[0];
            const idPicking = primeraLinea ? primeraLinea.PickListIdNumber : null;

            // Si no hay proceso de picking previo
            if (!idPicking) {
                return {
                    success: true,
                    guia: trackingNumber,
                    cliente: cliente,
                    paqueteria: "No especificada (Sin Picking)",
                    colaborador: "No especificado (Sin Picking)",
                    folioEntrega: delivery.DocNum
                };
            }

            // 2. Buscamos el detalle del Picking
            const pickingData = await this.getPickListByID(session, idPicking);

            return {
                success: true,
                guia: trackingNumber,
                cliente: cliente,
                paqueteria: pickingData.U_Paqueteria || "No definida",
                colaborador: pickingData.Name || "No asignado",
                folioEntrega: delivery.DocNum,
                idPicking: idPicking
            };

        } catch (error) {
            console.error('Error en el orquestador de rastreo:');
            throw error;
        }
    }

    /**
     * Busca información de envío para múltiples guías usando una sola sesión SAP.
     * @param {string[]} trackingNumbers
     * @returns {Promise<Array>}
     */
    static async getTrackingInfoBatch(trackingNumbers) {
        if (!Array.isArray(trackingNumbers) || trackingNumbers.length === 0) {
            return [];
        }

        const session = await this.login();
        const resultados = [];

        for (const guia of trackingNumbers) {
            try {
                const deliveryData = await this.getDeliveryByTrackingNumber(session, guia);

                if (!deliveryData.value || deliveryData.value.length === 0) {
                    resultados.push({ success: false, guia, message: 'No encontrada en SAP' });
                    continue;
                }

                const delivery = deliveryData.value[0];
                const primeraLinea = delivery.DocumentLines?.[0];
                const idPicking = primeraLinea?.PickListIdNumber ?? null;

                if (!idPicking) {
                    resultados.push({
                        success: true,
                        guia,
                        cliente: delivery.CardName,
                        paqueteria: null,
                        colaborador: null,
                        folioEntrega: delivery.DocNum,
                        idPicking: null
                    });
                    continue;
                }

                const pickingData = await this.getPickListByID(session, idPicking);
                resultados.push({
                    success: true,
                    guia,
                    cliente: delivery.CardName,
                    paqueteria: pickingData.U_Paqueteria || null,
                    colaborador: pickingData.Name || null,
                    folioEntrega: delivery.DocNum,
                    idPicking
                });
            } catch (error) {
                console.error(`Error al consultar guía ${guia} en SAP:`, error.message);
                resultados.push({ success: false, guia, message: error.message });
            }
        }

        return resultados;
    }
}