import express from 'express';
import { CotizacionController } from '../controllers/cotizacion.controller.js';

const router = express.Router();

// Endpoint compatible original
router.post('/generar', CotizacionController.generarCotizacion);

// Nuevo endpoint: obtener candidates / resumen para una solicitud (discovery)
router.post('/generar/candidates', CotizacionController.descubrirProductos);

// Nuevo endpoint: enviar selección en lenguaje natural y generar cotización
router.post('/generar/seleccionar', CotizacionController.seleccionarYCotizar);

router.get('/productos', CotizacionController.listarProductos);

export default router;