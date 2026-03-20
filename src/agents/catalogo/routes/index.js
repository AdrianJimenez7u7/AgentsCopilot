import { Router } from 'express';
import configuracionRoutes from './configuracion.routes.js';
import aplicacionRoutes from './aplicacion.routes.js';
import metricasCostosRoutes from './metricas_costos.routes.js';

const router = Router();

router.use('/configuraciones', configuracionRoutes);
router.use('/aplicaciones', aplicacionRoutes);
router.use('/', metricasCostosRoutes); // Maneja /aplicaciones/:id/metricas y /aplicaciones/:id/costos

export default router;
