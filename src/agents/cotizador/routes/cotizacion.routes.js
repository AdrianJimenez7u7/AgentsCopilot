import express from 'express';
import { CotizacionController } from '../controllers/cotizacion.controller.js';

const router = express.Router();

router.post('/generar', CotizacionController.generarCotizacion);
router.get('/productos', CotizacionController.listarProductos);

export default router;