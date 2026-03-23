import { Router } from 'express';
import { AplicacionController } from '../controllers/aplicacion.controller.js';

const router = Router();

router.get('/', AplicacionController.getAll);
router.get('/:id', AplicacionController.getById);
router.post('/', AplicacionController.create);
router.put('/:id', AplicacionController.update);
router.delete('/:id', AplicacionController.delete);

export default router;
