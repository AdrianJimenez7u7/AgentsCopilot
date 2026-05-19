import express from 'express';
import { ContadoresController } from '../controllers/contadores.controller.js';
import { agentController } from '../controllers/agent.controller.js';

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

export default router;