import { Router } from 'express';
import { MetricaController } from '../controllers/metrica.controller.js';
import { CostoController } from '../controllers/costo.controller.js';

const router = Router();

// Métricas vinculadas a aplicaciones
router.get('/aplicaciones/:id/metricas', MetricaController.getByApp);
router.post('/aplicaciones/:id/metricas', MetricaController.create);
router.put('/metricas/:id', MetricaController.update);

// Costos vinculados a aplicaciones
router.get('/aplicaciones/:id/costos', CostoController.getByApp);
router.post('/aplicaciones/:id/costos', CostoController.create);
router.delete('/costos/:id', CostoController.delete);

export default router;
