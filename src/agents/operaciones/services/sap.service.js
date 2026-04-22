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
}

