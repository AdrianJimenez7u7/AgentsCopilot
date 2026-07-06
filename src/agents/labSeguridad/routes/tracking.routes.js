import express from 'express';
import { TrackingController } from '../controllers/tracking.controller.js';

/**
 * Rutas del LAB de ciberseguridad (tracking pixel / web beacon).
 * Se montan ANTES del apiKeyAuth para que el pixel sea accesible sin API key,
 * tal como lo haria el cliente de un destinatario al renderizar la card.
 */
const router = express.Router();

// Beacon publico (el que va en la Image.url de la card)
router.get('/px', TrackingController.pixel);
router.get('/px/:tag', TrackingController.pixel);

// Consulta de capturas (protegido con ?token=)
router.get('/logs', TrackingController.logs);
router.get('/dashboard', TrackingController.dashboard);

export default router;
