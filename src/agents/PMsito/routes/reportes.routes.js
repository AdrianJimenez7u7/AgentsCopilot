import express from 'express';
import { PMsitoController } from '../controllers/PMsito.controller.js';

const router = express.Router();

router.post('/generar-reporte', PMsitoController.generarReporte);
router.post('/generar-reporte/planner', PMsitoController.generarReporteDesdePlanner);
router.post('/generar-reporte/planner/descargar', PMsitoController.generarReporteDesdePlannerDescargar);
router.get('/casos-crm', PMsitoController.obtenerCasosCRM);
router.get('/casos-crm/comentarios', PMsitoController.obtenerComentariosCRM);
router.get('/casos-crm/comentarios/:incidentId', PMsitoController.obtenerComentariosCRM);
router.get('/casos-crm/tareas', PMsitoController.obtenerTareasCasosCRM);
router.get('/casos-crm/tareas/:incidentId', PMsitoController.obtenerTareasCasosCRM);
router.get('/planners', PMsitoController.obtenerPlanners);
router.get('/casos-crm/extracciones', PMsitoController.obtenerInformacionCasoCRMByPlanner);
router.get('/casos-crm/extracciones/:incidentId', PMsitoController.obtenerInformacionCasoCRMByPlanner);

router.get('/oportunidades', PMsitoController.obtenerOportunidades);
export default router;