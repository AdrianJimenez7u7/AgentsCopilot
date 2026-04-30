import express from 'express';
import { PMsitoController } from '../controllers/PMsito.controller.js';

const router = express.Router();

router.post('/generar-reporte', PMsitoController.generarReporte);
router.get('/casos-crm', PMsitoController.obtenerCasosCRM);
router.get('/casos-crm/comentarios', PMsitoController.obtenerComentariosCRM);
router.get('/casos-crm/comentarios/:incidentId', PMsitoController.obtenerComentariosCRM);
router.get('/casos-crm/tareas', PMsitoController.obtenerTareasCasosCRM);
router.get('/casos-crm/tareas/:incidentId', PMsitoController.obtenerTareasCasosCRM);
router.get('/planners', PMsitoController.obtenerPlanners);
router.get('/planners/carteras', PMsitoController.obtenerCarteras);
export default router;