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
     * Enriquece artículos con su desglose por ubicación/bin (OIBQ+OBIN, ver getBinLocationContent)
     * y, opcionalmente, su stock por almacén (ItemWarehouseInfoCollection).
     * Ambas llamadas por artículo corren en paralelo para no duplicar la latencia.
     * @param {object} session
     * @param {Array}  items
     * @param {string} [warehouseCode] - Filtra almacenes y bins a uno específico
     * @param {boolean} [includeWarehouseInfo=true] - Si false, omite ItemWarehouseInfoCollection (y su llamada a SAP)
     */
    static async _enrichItemsWithStockAndBins(session, items, warehouseCode, includeWarehouseInfo = true) {
        const STOCK_FIELDS = ['WarehouseCode', 'InStock', 'Committed', 'Ordered'];
        const pickStockFields = (w) => Object.fromEntries(STOCK_FIELDS.map(k => [k, w[k]]));
        const headers = { 'Cookie': `B1SESSION=${session.SessionId}` };

        await this._ensureSQLQueryBinLocationContent(session);

        return Promise.all(items.map(async (item) => {
            const [warehouses, bins] = await Promise.all([
                includeWarehouseInfo
                    ? axios.get(
                        `${process.env.SAP_BASE_URL}Items('${encodeURIComponent(item.ItemCode)}')/ItemWarehouseInfoCollection`,
                        { headers, httpsAgent }
                      ).then(res => (res.data?.ItemWarehouseInfoCollection ?? []).map(pickStockFields))
                       .catch(err => {
                          console.error(`[SAP] ItemWarehouseInfoCollection error para ${item.ItemCode}:`, err.response?.data ?? err.message);
                          return [];
                       })
                    : Promise.resolve(null),
                this._queryBinLocationContent(session, item.ItemCode)
                    .then(rows => rows.map(({ ItemCode, ...rest }) => rest))
                    .catch(err => {
                        console.error(`[SAP] BinLocationContent error para ${item.ItemCode}:`, err.response?.data ?? err.message);
                        return [];
                    })
            ]);

            const enriched = {
                ...item,
                BinLocations: warehouseCode ? bins.filter(b => b.WhsCode === warehouseCode) : bins
            };
            if (includeWarehouseInfo) {
                enriched.ItemWarehouseInfoCollection = warehouseCode ? warehouses.filter(w => w.WarehouseCode === warehouseCode) : warehouses;
            }
            return enriched;
        }));
    }

    /**
     * Obtiene una lista de artículos de SAP.
     * @param {object} session
     * @param {object} opts
     * @param {string}  [opts.search]    - Texto libre: busca en ItemCode e ItemName
     * @param {string}  [opts.itemGroup] - Filtra por código de grupo de artículo
     * @param {number}  [opts.top=20]    - Máximo de registros a retornar
     * @param {number}  [opts.skip=0]    - Paginación
     * @param {boolean} [opts.withStock] - Si true, agrega stock por almacén y por bin (BinLocations) a cada artículo
     */
    static async getItems(session, { search, itemGroup, top = 20, skip = 0, fetchAll = false, withStock = false, warehouseCode } = {}) {
        const filters = [];
        if (search) {
            const safe = search.replace(/'/g, "''");
            filters.push(`(contains(ItemCode,'${safe}') or contains(ItemName,'${safe}'))`);
        }
        if (itemGroup) {
            const group = parseInt(itemGroup);
            if (!isNaN(group)) filters.push(`ItemsGroupCode eq ${group}`);
        }

        const staticParams = [
            filters.length ? `$filter=${filters.join(' and ')}` : '',
            `$select=ItemCode,ItemName,QuantityOnStock,ItemType,ItemsGroupCode,SalesUnit,PurchaseUnit`,
            `$orderby=ItemCode asc`
        ].filter(Boolean).join('&');

        try {
            if (fetchAll) {
                const raw = await this._fetchAllPages(session, `${process.env.SAP_BASE_URL}Items?${staticParams}`);
                const value = withStock ? await this._enrichItemsWithStockAndBins(session, raw, warehouseCode) : raw;
                return { value };
            }

            const params = `${staticParams}&$top=${top}&$skip=${skip}`;
            const response = await axios.get(`${process.env.SAP_BASE_URL}Items?${params}`, {
                headers: { 'Cookie': `B1SESSION=${session.SessionId}` },
                httpsAgent
            });

            if (withStock && response.data?.value) {
                response.data.value = await this._enrichItemsWithStockAndBins(session, response.data.value, warehouseCode);
            }

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
     * @param {boolean} [opts.active]    - Si true, solo almacenes activos (Inactive eq 'tNO')
     * @param {number}  [opts.top=50]
     * @param {number}  [opts.skip=0]
     * @param {boolean} [opts.fetchAll]  - Si true, ignora top/skip y trae todos los registros paginando
     */
    static async getWarehouses(session, { active, top = 50, skip = 0, fetchAll = false } = {}) {
        const filters = [];
        if (active) filters.push(`Inactive eq 'tNO'`);

        const staticParams = [
            filters.length ? `$filter=${filters.join(' and ')}` : '',
            `$select=WarehouseCode,WarehouseName,City,Country,Inactive`,
            `$orderby=WarehouseCode asc`
        ].filter(Boolean).join('&');

        try {
            if (fetchAll) {
                const value = await this._fetchAllPages(session, `${process.env.SAP_BASE_URL}Warehouses?${staticParams}`);
                return { value };
            }

            const params = `${staticParams}&$top=${top}&$skip=${skip}`;
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
     * Obtiene artículos con existencias desglosadas por ubicación/bin (BinLocations).
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
            const safe = search.replace(/'/g, "''");
            filters.push(`(contains(ItemCode,'${safe}') or contains(ItemName,'${safe}'))`);
        }
        if (itemGroup) {
            const group = parseInt(itemGroup);
            if (!isNaN(group)) filters.push(`ItemsGroupCode eq ${group}`);
        }

        const staticParams = [
            filters.length ? `$filter=${filters.join(' and ')}` : '',
            `$select=ItemCode,ItemName,ItemType,ItemsGroupCode`,
            `$orderby=ItemCode asc`
        ].filter(Boolean).join('&');

        try {
            if (fetchAll) {
                const raw = await this._fetchAllPages(session, `${process.env.SAP_BASE_URL}Items?${staticParams}`);
                return { value: await this._enrichItemsWithStockAndBins(session, raw, warehouseCode, false) };
            }

            const params = `${staticParams}&$top=${top}&$skip=${skip}`;
            const response = await axios.get(`${process.env.SAP_BASE_URL}Items?${params}`, {
                headers: { 'Cookie': `B1SESSION=${session.SessionId}` },
                httpsAgent
            });

            if (response.data?.value) {
                response.data.value = await this._enrichItemsWithStockAndBins(session, response.data.value, warehouseCode, false);
            }

            return response.data;
        } catch (error) {
            console.error('Error al obtener Items con stock por ubicación:', error.response?.data ?? error.message);
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

    // ==========================================
    // BIN LOCATIONS (CONTENIDO DE UBICACIÓN)
    // ==========================================

    /**
     * Da de alta o actualiza en SAP el SQL Query usado para consultar el contenido
     * de ubicaciones por artículo. Replica el reporte nativo "Lista de contenidos
     * de ubicación", cruzando existencias por bin (OIBQ) con el catálogo de bins (OBIN).
     */
    static async _ensureSQLQueryBinLocationContent(session) {
        const SQL_CODE = 'ZZ_BinLocationContent';
        const SQL_TEXT = `SELECT T0."ItemCode", T0."WhsCode", T1."BinCode", T0."OnHandQty" FROM "OIBQ" T0 INNER JOIN "OBIN" T1 ON T0."BinAbs" = T1."AbsEntry" WHERE T0."ItemCode" = :itemCode AND T0."OnHandQty" > 0 ORDER BY T1."BinCode"`;

        const headers = { 'Cookie': `B1SESSION=${session.SessionId}` };
        try {
            await axios.get(`${process.env.SAP_BASE_URL}SQLQueries('${SQL_CODE}')`, { headers, httpsAgent });
            await axios.patch(`${process.env.SAP_BASE_URL}SQLQueries('${SQL_CODE}')`, {
                SqlText: SQL_TEXT
            }, { headers, httpsAgent });
        } catch (getErr) {
            if (getErr.response?.status !== 404) {
                console.error(`Error al verificar/actualizar SQL Query '${SQL_CODE}':`, getErr.response?.data ?? getErr.message);
                return;
            }
            try {
                await axios.post(`${process.env.SAP_BASE_URL}SQLQueries`, {
                    SqlCode: SQL_CODE,
                    SqlName: 'Contenido de ubicacion por articulo',
                    SqlText: SQL_TEXT
                }, { headers, httpsAgent });
            } catch (createErr) {
                console.error(`Error al crear SQL Query '${SQL_CODE}':`, createErr.response?.data ?? createErr.message);
            }
        }
    }

    /**
     * Ejecuta el SQL Query de contenido de ubicación. Asume que ya fue dado de alta
     * (ver _ensureSQLQueryBinLocationContent) — no lo vuelve a verificar en cada llamada,
     * para no duplicar round-trips cuando se enriquecen listas completas de artículos.
     * @param {object} session
     * @param {string} itemCode
     * @returns {Array<{ItemCode:string, WhsCode:string, BinCode:string, OnHandQty:number}>}
     */
    static async _queryBinLocationContent(session, itemCode) {
        const SQL_CODE = 'ZZ_BinLocationContent';
        const safeItemCode = encodeURIComponent(`'${itemCode.replace(/'/g, "''")}'`);

        const response = await axios.post(
            `${process.env.SAP_BASE_URL}SQLQueries('${SQL_CODE}')/List`,
            { ParamList: `itemCode=${safeItemCode}` },
            { headers: { 'Cookie': `B1SESSION=${session.SessionId}` }, httpsAgent }
        );
        return response.data?.value ?? [];
    }

    /**
     * Obtiene el desglose de existencias por ubicación (bin) de un artículo,
     * equivalente al reporte de SAP "Lista de contenidos de ubicación".
     * @param {object} session
     * @param {string} itemCode
     * @returns {Array<{ItemCode:string, WhsCode:string, BinCode:string, OnHandQty:number}>}
     */
    static async getBinLocationContent(session, itemCode) {
        if (!itemCode) throw new Error('itemCode es requerido');

        await this._ensureSQLQueryBinLocationContent(session);

        try {
            return await this._queryBinLocationContent(session, itemCode);
        } catch (error) {
            console.error(`Error al obtener contenido de ubicación para ${itemCode}:`, error.response?.data ?? error.message);
            throw error;
        }
    }
}
