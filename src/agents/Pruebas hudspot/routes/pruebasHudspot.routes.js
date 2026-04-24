import express from 'express';
import { PruebasHudspotController } from '../controllers/pruebasHudspot.controller.js';

const router = express.Router();

router.post('/interes', PruebasHudspotController.registrarInteres);

export default router;
