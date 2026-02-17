import express from 'express';
import { ProductosController } from '../controllers/productos.controller.js';

const router = express.Router();

router.post('/search', ProductosController.extractProductData);
router.post('/serach/file', ProductosController.extractSKUfromDocument)
router.post('/permissions', ProductosController.getPermissions);
router.post('/permissions/search', ProductosController.isSearchUser);
router.post('/permissions/ticket', ProductosController.isTicketUser);
router.post('/search-card', ProductosController.getProductCard);


export default router;
