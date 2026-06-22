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

    /**
     * Recorre todas las páginas de un endpoint OData hasta agotar los resultados.
     * @param {object} session
     * @param {string} url      - URL base sin $top/$skip
     * @param {number} pageSize - Registros por página (default 20, máx permitido por el server SAP)
     * @returns {Array} Todos los registros concatenados
     */
    static async _fetchAllPages(session, url, pageSize = 20) {
        const all = [];
        let skip = 0;

        while (true) {
            const sep = url.includes('?') ? '&' : '?';
            const response = await axios.get(`${url}${sep}$top=${pageSize}&$skip=${skip}`, {
                headers: { 'Cookie': `B1SESSION=${session.SessionId}` },
                httpsAgent
            });

            const page = response.data?.value ?? [];
            all.push(...page);

            if (page.length < pageSize) break;
            skip += pageSize;
        }

        return all;
    }

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
            console.error('Error al iniciar sesión en SAP:', error.response?.data ?? error.message);
            throw error;
        }
    }

    // ==========================================
    // ITEMS
    // ==========================================

    /**
     * Obtiene una lista de artículos de SAP.
     * @param {object} session
     * @param {object} opts
     * @param {string}  [opts.search]    - Texto libre: busca en ItemCode e ItemName
     * @param {string}  [opts.itemGroup] - Filtra por código de grupo de artículo
     * @param {number}  [opts.top=20]    - Máximo de registros a retornar
     * @param {number}  [opts.skip=0]    - Paginación
     */
    static async getItems(session, { search, itemGroup, top = 20, skip = 0, fetchAll = false } = {}) {
        const filters = [];
        if (search) {
            filters.push(`(contains(ItemCode,'${search}') or contains(ItemName,'${search}'))`);
        }
        if (itemGroup) {
            filters.push(`ItemsGroupCode eq ${itemGroup}`);
        }

        const staticParams = [
            filters.length ? `$filter=${filters.join(' and ')}` : '',
            `$select=ItemCode,ItemName,QuantityOnStock,ItemType,ItemsGroupCode,SalesUnit,PurchaseUnit`,
            `$orderby=ItemCode asc`
        ].filter(Boolean).join('&');

        try {
            if (fetchAll) {
                const value = await this._fetchAllPages(session, `${process.env.SAP_BASE_URL}Items?${staticParams}`);
                return { value };
            }

            const params = `${staticParams}&$top=${top}&$skip=${skip}`;
            const response = await axios.get(`${process.env.SAP_BASE_URL}Items?${params}`, {
                headers: { 'Cookie': `B1SESSION=${session.SessionId}` },
                httpsAgent
            });
            return response.data;
        } catch (error) {
            console.error('Error al obtener Items de SAP:', error.response?.data ?? error.message);
            throw error;
        }
    }

    /**
     * Obtiene un artículo específico por su código.
     * @param {object} session
     * @param {string} itemCode
     */
    static async getItemByCode(session, itemCode) {
        try {
            const response = await axios.get(
                `${process.env.SAP_BASE_URL}Items('${encodeURIComponent(itemCode)}')`,
                {
                    headers: { 'Cookie': `B1SESSION=${session.SessionId}` },
                    httpsAgent
                }
            );
            return response.data;
        } catch (error) {
            console.error(`Error al obtener Item ${itemCode} de SAP:`, error.response?.data ?? error.message);
            throw error;
        }
    }

    // ==========================================
    // INVENTORY TRANSFER REQUESTS
    // ==========================================

    /**
     * Obtiene solicitudes de transferencia de inventario.
     * @param {object} session
     * @param {object} opts
     * @param {string}  [opts.status]        - 'bost_Open' | 'bost_Close'
     * @param {string}  [opts.fromWarehouse] - Código de almacén origen
     * @param {string}  [opts.toWarehouse]   - Código de almacén destino
     * @param {string}  [opts.fromDate]      - Fecha inicio (YYYY-MM-DD)
     * @param {string}  [opts.toDate]        - Fecha fin (YYYY-MM-DD)
     * @param {number}  [opts.top=20]
     * @param {number}  [opts.skip=0]
     */
    static async getInventoryTransferRequests(session, { status, fromWarehouse, toWarehouse, fromDate, toDate, top = 20, skip = 0 } = {}) {
        const filters = [];
        if (status)        filters.push(`DocumentStatus eq '${status}'`);
        if (fromWarehouse) filters.push(`FromWarehouse eq '${fromWarehouse}'`);
        if (toWarehouse)   filters.push(`ToWarehouse eq '${toWarehouse}'`);
        if (fromDate)      filters.push(`DocDate ge '${fromDate}'`);
        if (toDate)        filters.push(`DocDate le '${toDate}'`);

        const params = [
            filters.length ? `$filter=${filters.join(' and ')}` : '',
            `$top=${top}`,
            `$skip=${skip}`,
            `$orderby=DocDate desc`
        ].filter(Boolean).join('&');

        try {
            const response = await axios.get(`${process.env.SAP_BASE_URL}InventoryTransferRequests?${params}`, {
                headers: { 'Cookie': `B1SESSION=${session.SessionId}` },
                httpsAgent
            });
            return response.data;
        } catch (error) {
            console.error('Error al obtener InventoryTransferRequests de SAP:', error.response?.data ?? error.message);
            throw error;
        }
    }

    // ==========================================
    // WAREHOUSES (ALMACENES / SUCURSALES)
    // ==========================================

    /**
     * Lista los almacenes/sucursales configurados en SAP.
     * @param {object} session
     * @param {object} opts
     * @param {boolean} [opts.active]   - Si true, solo almacenes activos (Inactive eq 'tNO')
     * @param {number}  [opts.top=50]
     * @param {number}  [opts.skip=0]
     */
    static async getWarehouses(session, { active, top = 50, skip = 0 } = {}) {
        const filters = [];
        if (active) filters.push(`Inactive eq 'tNO'`);

        const params = [
            filters.length ? `$filter=${filters.join(' and ')}` : '',
            `$select=WarehouseCode,WarehouseName,City,Country,Inactive`,
            `$top=${top}`,
            `$skip=${skip}`,
            `$orderby=WarehouseCode asc`
        ].filter(Boolean).join('&');

        try {
            const response = await axios.get(`${process.env.SAP_BASE_URL}Warehouses?${params}`, {
                headers: { 'Cookie': `B1SESSION=${session.SessionId}` },
                httpsAgent
            });
            return response.data;
        } catch (error) {
            console.error('Error al obtener Warehouses de SAP:', error.response?.data ?? error.message);
            throw error;
        }
    }

    /**
     * Obtiene artículos con stock desglosado por almacén.
     * @param {object} session
     * @param {object} opts
     * @param {string}  [opts.search]        - Texto libre en ItemCode o ItemName
     * @param {string}  [opts.itemGroup]     - Código de grupo de artículo
     * @param {string}  [opts.warehouseCode] - Filtra por almacén específico
     * @param {number}  [opts.top=20]
     * @param {number}  [opts.skip=0]
     */
    static async getItemsStock(session, { search, itemGroup, warehouseCode, top = 20, skip = 0, fetchAll = false } = {}) {
        const filters = [];
        if (search) {
            filters.push(`(contains(ItemCode,'${search}') or contains(ItemName,'${search}'))`);
        }
        if (itemGroup) {
            filters.push(`ItemsGroupCode eq ${itemGroup}`);
        }

        const expandFilter = warehouseCode
            ? `ItemWarehouseInfoCollection($filter=WarehouseCode eq '${warehouseCode}';$select=WarehouseCode,InStock,Committed,Ordered)`
            : `ItemWarehouseInfoCollection($select=WarehouseCode,InStock,Committed,Ordered)`;

        const staticParams = [
            filters.length ? `$filter=${filters.join(' and ')}` : '',
            `$select=ItemCode,ItemName,ItemType,ItemsGroupCode`,
            `$expand=${expandFilter}`,
            `$orderby=ItemCode asc`
        ].filter(Boolean).join('&');

        const applyWarehouseFilter = (items) => {
            if (!warehouseCode) return items;
            return items.map(item => ({
                ...item,
                ItemWarehouseInfoCollection: (item.ItemWarehouseInfoCollection ?? [])
                    .filter(w => w.WarehouseCode === warehouseCode)
            }));
        };

        try {
            if (fetchAll) {
                const raw = await this._fetchAllPages(session, `${process.env.SAP_BASE_URL}Items?${staticParams}`);
                return { value: applyWarehouseFilter(raw) };
            }

            const params = `${staticParams}&$top=${top}&$skip=${skip}`;
            const response = await axios.get(`${process.env.SAP_BASE_URL}Items?${params}`, {
                headers: { 'Cookie': `B1SESSION=${session.SessionId}` },
                httpsAgent
            });

            if (response.data?.value) {
                response.data.value = applyWarehouseFilter(response.data.value);
            }

            return response.data;
        } catch (error) {
            console.error('Error al obtener Items con stock por almacén:', error.response?.data ?? error.message);
            throw error;
        }
    }

    /**
     * Obtiene una solicitud de transferencia específica por DocEntry.
     * @param {object} session
     * @param {number} docEntry
     */
    static async getInventoryTransferRequestByDocEntry(session, docEntry) {
        try {
            const response = await axios.get(
                `${process.env.SAP_BASE_URL}InventoryTransferRequests(${docEntry})`,
                {
                    headers: { 'Cookie': `B1SESSION=${session.SessionId}` },
                    httpsAgent
                }
            );
            return response.data;
        } catch (error) {
            console.error(`Error al obtener InventoryTransferRequest ${docEntry} de SAP:`, error.response?.data ?? error.message);
            throw error;
        }
    }
}
