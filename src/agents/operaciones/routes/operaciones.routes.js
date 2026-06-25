import express from 'express';
import { ProductosController } from '../controllers/productos.controller.js';
import { DHLcontroller } from '../controllers/dhl.controller.js';
import { agentController } from '../controllers/agent.controller.js';
import { PaqueteriasController } from '../controllers/paqueterias.controller.js';
import { GuiasController } from '../controllers/guias.controller.js';
import { ejecutarReporteDiario } from '../../../shared/jobs/reporteDiario.job.js';
const router = express.Router();
const agent = new agentController();

router.post('/search', ProductosController.extractProductData);
router.post('/search/file', ProductosController.uploadXLSX, ProductosController.extractSKUfromXLSX);
router.get('/search/pending-validations', ProductosController.getPendingValidations);
router.put('/search/validate/:id', ProductosController.updateValidationStatus);
router.get('/search/all-products', ProductosController.getAllProducts);
router.post('/search/validate-card', ProductosController.validateFromCard);
router.post('/permissions', ProductosController.getPermissions);
router.post('/permissions/search', ProductosController.isSearchUser);
router.post('/permissions/ticket', ProductosController.isTicketUser);
router.post('/search-card', ProductosController.getProductCard);
router.get('/marcas-codigos-clasificacion', ProductosController.getMarcasAndCodigosClasificacion);
router.delete('/search/pending/:id', ProductosController.deletePendingProduct);

// ── TEST: clasificación con modelo de razonamiento gpt-5-mini ──────────────
router.post('/clasificar-test', ProductosController.clasificarProductoTest);

router.post('/my-data', ProductosController.getMyData);

router.get('/products-from-sharepoint-list', ProductosController.getProductsFromSharepointList);
router.get('/sharepoint-list-metadata', ProductosController.getSharepointListMetadata);

router.post('/user-by-purchase-order', ProductosController.getUserByPurchaseOrder);

// ── ENDPOINTS PAQUETERIA DHL ──────────────
router.post('/dhl/validateAddress', DHLcontroller.validateAddress);
router.post('/dhl/trackShipment', DHLcontroller.trackShipment);
router.post('/dhl/trackSingleShipment', DHLcontroller.trackSingleShipment);
router.post('/dhl/getRates', DHLcontroller.getRates);
router.post('/dhl/getMultiPieceRates', DHLcontroller.getMultiPieceRates);
router.post('/dhl/getLandedCost', DHLcontroller.getLandedCost);
router.post('/dhl/getShipmentImage', DHLcontroller.getShipmentImage);
router.post('/dhl/getProofOfDelivery', DHLcontroller.getProofOfDelivery);
router.post('/dhl/getProducts', DHLcontroller.getProducts);
router.post('/dhl/getIdentifiers', DHLcontroller.getIdentifiers);


// ── ENDPOINTS AGENTE ──────────────
router.post('/agent/sendMessage', agentController.uploadFile, agent.procesarMensaje.bind(agent));
router.get('/agent/threads', agent.listThreads.bind(agent));
router.get('/agent/threads/:threadId/messages', agent.getThreadMessages.bind(agent));

// ── GUIAS (CRUCE CON EXCEL) ──────────────
router.post('/guias/cruce', GuiasController.uploadGuias, GuiasController.analizarCruce);

// -- PAQUETERIAS ---
router.get('/paqueterias', PaqueteriasController.getPaqueterias);
router.post('/cotizar', PaqueteriasController.createCotizacion);
router.get('/cotizaciones', PaqueteriasController.getCotizacionesByStatus);
router.post('/cotizaciones/autorizar', PaqueteriasController.autorizarCotizacion);
router.post('/cotizaciones/rechazar', PaqueteriasController.rechazarCotizacion);

router.get('/envios', PaqueteriasController.getAllEnvios);
router.put('/envios/:idEnvio', PaqueteriasController.updateEnvio);
router.post('/envios/guia', PaqueteriasController.addGuiaToEnvio);

// ── TEST: disparo manual del reporte diario ──────────────
router.post('/reporte-diario/test', async (req, res) => {
    try {
        await ejecutarReporteDiario();
        res.json({ ok: true, message: 'Reporte enviado correctamente' });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
