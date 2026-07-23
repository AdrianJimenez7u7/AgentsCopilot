import express from 'express';
import { ContadoresController } from '../controllers/contadores.controller.js';
import { agentController } from '../controllers/agent.controller.js';
import { SapController } from '../controllers/sap.controller.js';
import { CierresComentariosController } from '../controllers/cierresComentarios.controller.js';
import { CierresController } from '../controllers/cierres.controller.js';
import { CierreFacturacionController } from '../controllers/cierreFacturacion.controller.js';

const router = express.Router();
const agent = new agentController();

// Endpoint para dividir PDF en páginas individuales
router.post('/split-pdf', ContadoresController.uploadPdf, ContadoresController.splitPdf);

// Endpoint para limpiar la carpeta de salida
router.delete('/clean-output', ContadoresController.cleanOutput);

// Endpoint para analizar PDFs con Azure AI
router.post('/analyze-pdfs', ContadoresController.analyzePdfs);

// Endpoint combinado: dividir y analizar PDF
router.post('/process-pdf', ContadoresController.uploadPdf, ContadoresController.processPdf);

// Endpoint para generar reportes
router.get('/generate-report', ContadoresController.generateReport);
router.post('/generate-report', ContadoresController.generateReport);


// Enpoints para funciones de clientes
router.get('/clientes', ContadoresController.getClientes);

router.get('/contadores', ContadoresController.getContadores);

router.post('/clientes/bulk', ContadoresController.uploadCsv, ContadoresController.bulkClientesByCSV);
router.post('/clientes', ContadoresController.createImpresoraCliente);

router.put('/clientes/:id', ContadoresController.updateImpresoraCliente);

router.delete('/clientes/:id', ContadoresController.deleteCliente);

router.get('/reportes-faltantes', ContadoresController.obtenerReportesFaltantes);

router.get('/alerta-reportes', ContadoresController.alertarReportesFaltantes);

router.get('/alerta-escaneos', ContadoresController.alertarEscaneosFaltantes);

router.get('/escaneos-faltantes', ContadoresController.escaneosFaltantes);

router.post('/escaneos/importar', ContadoresController.importarEscaneosExcel);

router.get('/alerta-escaneos-tecnico/:tecnico', ContadoresController.alertarEscaneosFaltantesPorTecnico);

router.get('/validate-all-exist-reports-state-null', ContadoresController.validateAllExistReportsStateNull);

router.post('/contadores/fecha', ContadoresController.obtenerContadoresPorFecha);

router.post('/clientes/bulk', ContadoresController.uploadCsv, ContadoresController.bulkClientesByCSV);

router.get('/tecnicos', ContadoresController.getTecnicos);

router.post('/pdf/counter', ContadoresController.uploadPdf, ContadoresController.obtenerNumeroHojas);

router.post('/root/chat', agentController.uploadPdf, agent.chat.bind(agent));

// ── Cierres ──────────────────────────────────
router.get('/cierres', CierresController.getAll);
router.get('/cierres/:id', CierresController.getById);
router.post('/cierres/cliente', CierresController.cierreFormal);
router.delete('/cierres/:id', CierresController.remove);

// ── Cierres Facturación ───────────────────────
router.get('/cierres-facturacion', CierreFacturacionController.getAll);
router.get('/cierres-facturacion/:id', CierreFacturacionController.getById);
router.post('/cierres-facturacion', CierreFacturacionController.create);
router.delete('/cierres-facturacion/:id', CierreFacturacionController.remove);

// ── Cierres Comentarios ──────────────────────
router.get('/cierres-comentarios', CierresComentariosController.getAll);
router.get('/cierres-comentarios/:id', CierresComentariosController.getById);
router.post('/cierres-comentarios', CierresComentariosController.create);
router.put('/cierres-comentarios/:id', CierresComentariosController.update);
router.delete('/cierres-comentarios/:id', CierresComentariosController.remove);

// ── SAP ──────────────────────────────────────
router.get('/sap/warehouses', SapController.getWarehouses);
router.get('/sap/items', SapController.getItems);
router.get('/sap/items/stock', SapController.getItemsStock);
router.get('/sap/items/:itemCode', SapController.getItemByCode);
router.get('/sap/inventory-transfer-requests', SapController.getInventoryTransferRequests);
router.get('/sap/inventory-transfer-requests/:docEntry', SapController.getInventoryTransferRequestByDocEntry);
router.get('/sap/items/:itemCode/bin-locations', SapController.getBinLocationContent);

export default router;