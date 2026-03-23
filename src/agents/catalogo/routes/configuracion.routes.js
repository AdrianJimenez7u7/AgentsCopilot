import { Router } from 'express';
import { ConfiguracionController } from '../controllers/configuracion.controller.js';

const router = Router();

router.get('/', ConfiguracionController.getVigente);
router.post('/', ConfiguracionController.create);

export default router;
