import express from 'express';
import { ProductosController } from '../controllers/productos.controller.js';

const router = express.Router();

router.post('/search', ProductosController.extractProductData);


export default router;