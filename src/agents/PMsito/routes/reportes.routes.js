import express from 'express';
import { PMsitoController } from '../controllers/PMsito.controller.js';

const router = express.Router();

router.post('/generar-reporte', PMsitoController.generarReporte);

export default router;