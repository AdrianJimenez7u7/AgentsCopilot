import express from 'express';
import { ContadoresController } from '../controllers/contadores.controller.js';

const router = express.Router();

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


// Enpoints para funciones de clientes
router.get('/clientes', ContadoresController.getClientes);

router.get('/contadores', ContadoresController.getContadores);

router.post('/clientes', ContadoresController.createImpresoraCliente);

router.get('/reportes-faltantes', ContadoresController.obtenerReportesFaltantes);

router.get('/alerta-reportes', ContadoresController.alertarReportesFaltantes);

export default router;