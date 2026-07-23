import { SapService } from '../services/sap.service.js';

export class SapController {

    // ==========================================
    // ITEMS
    // ==========================================

    /**
     * GET /sap/items
     * Query params: search, itemGroup, top, skip
     */
    static async getItems(req, res) {
        try {
            const { search, itemGroup, top, skip, fetchAll, withStock, warehouseCode } = req.query;
            const session = await SapService.login();
            const data = await SapService.getItems(session, {
                search,
                itemGroup,
                fetchAll: fetchAll === 'true',
                withStock: withStock === 'true',
                warehouseCode,
                top:  top  ? parseInt(top)  : 20,
                skip: skip ? parseInt(skip) : 0
            });
            return res.status(200).json(data);
        } catch (error) {
            const detalle = error.response?.data ?? error.message;
            return res.status(500).json({ error: 'Error al consultar Items en SAP', detalle });
        }
    }

    /**
     * GET /sap/items/:itemCode
     */
    static async getItemByCode(req, res) {
        try {
            const { itemCode } = req.params;
            if (!itemCode) {
                return res.status(400).json({ error: 'itemCode es requerido' });
            }
            const session = await SapService.login();
            const data = await SapService.getItemByCode(session, itemCode);
            return res.status(200).json(data);
        } catch (error) {
            const status = error.response?.status === 404 ? 404 : 500;
            const detalle = error.response?.data ?? error.message;
            return res.status(status).json({ error: 'Error al consultar Item en SAP', detalle });
        }
    }

    // ==========================================
    // INVENTORY TRANSFER REQUESTS
    // ==========================================

    /**
     * GET /sap/inventory-transfer-requests
     * Query params: status, fromWarehouse, toWarehouse, fromDate, toDate, top, skip
     */
    static async getInventoryTransferRequests(req, res) {
        try {
            const { status, fromWarehouse, toWarehouse, fromDate, toDate, top, skip } = req.query;
            const session = await SapService.login();
            const data = await SapService.getInventoryTransferRequests(session, {
                status,
                fromWarehouse,
                toWarehouse,
                fromDate,
                toDate,
                top:  top  ? parseInt(top)  : 20,
                skip: skip ? parseInt(skip) : 0
            });
            return res.status(200).json(data);
        } catch (error) {
            const detalle = error.response?.data ?? error.message;
            return res.status(500).json({ error: 'Error al consultar InventoryTransferRequests en SAP', detalle });
        }
    }

    // ==========================================
    // WAREHOUSES
    // ==========================================

    /**
     * GET /sap/warehouses
     * Query params: active (boolean), top, skip, fetchAll (boolean)
     * Por defecto trae TODOS los almacenes (paginando internamente, SAP limita $top a 20).
     * Pasa fetchAll=false junto con top/skip si necesitas paginar manualmente.
     */
    static async getWarehouses(req, res) {
        try {
            const { active, top, skip, fetchAll } = req.query;
            const session = await SapService.login();
            const data = await SapService.getWarehouses(session, {
                active: active === 'true',
                fetchAll: fetchAll !== 'false',
                top:  top  ? parseInt(top)  : 50,
                skip: skip ? parseInt(skip) : 0
            });
            return res.status(200).json(data);
        } catch (error) {
            const detalle = error.response?.data ?? error.message;
            return res.status(500).json({ error: 'Error al consultar Warehouses en SAP', detalle });
        }
    }

    /**
     * GET /sap/items/stock
     * Query params: search, itemGroup, warehouseCode, top, skip
     */
    static async getItemsStock(req, res) {
        try {
            const { search, itemGroup, warehouseCode, top, skip, fetchAll } = req.query;
            const session = await SapService.login();
            const data = await SapService.getItemsStock(session, {
                search,
                itemGroup,
                warehouseCode,
                fetchAll: fetchAll === 'true',
                top:  top  ? parseInt(top)  : 20,
                skip: skip ? parseInt(skip) : 0
            });
            return res.status(200).json(data);
        } catch (error) {
            const detalle = error.response?.data ?? error.message;
            return res.status(500).json({ error: 'Error al consultar stock por almacén en SAP', detalle });
        }
    }

    /**
     * GET /sap/inventory-transfer-requests/:docEntry
     */
    static async getInventoryTransferRequestByDocEntry(req, res) {
        try {
            const docEntry = parseInt(req.params.docEntry);
            if (isNaN(docEntry)) {
                return res.status(400).json({ error: 'docEntry debe ser un número entero' });
            }
            const session = await SapService.login();
            const data = await SapService.getInventoryTransferRequestByDocEntry(session, docEntry);
            return res.status(200).json(data);
        } catch (error) {
            const status = error.response?.status === 404 ? 404 : 500;
            const detalle = error.response?.data ?? error.message;
            return res.status(status).json({ error: 'Error al consultar InventoryTransferRequest en SAP', detalle });
        }
    }

    // ==========================================
    // BIN LOCATIONS
    // ==========================================

    /**
     * GET /sap/items/:itemCode/bin-locations
     * Equivalente al reporte de SAP "Lista de contenidos de ubicación".
     */
    static async getBinLocationContent(req, res) {
        try {
            const { itemCode } = req.params;
            if (!itemCode) {
                return res.status(400).json({ error: 'itemCode es requerido' });
            }
            const session = await SapService.login();
            const data = await SapService.getBinLocationContent(session, itemCode);
            return res.status(200).json({ value: data });
        } catch (error) {
            const detalle = error.response?.data ?? error.message;
            return res.status(500).json({ error: 'Error al consultar contenido de ubicación en SAP', detalle });
        }
    }
}
