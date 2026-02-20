import express from 'express';
import { ProductosController } from '../controllers/productos.controller.js';

const router = express.Router();

router.post('/search', ProductosController.extractProductData);
router.post('/search/file', ProductosController.uploadXLSX, ProductosController.extractSKUfromXLSX);
router.get('/search/pending-validations', ProductosController.getPendingValidations);
router.put('/search/validate/:id', ProductosController.updateValidationStatus);
router.post('/search/validate-card', ProductosController.validateFromCard);
router.post('/permissions', ProductosController.getPermissions);
router.post('/permissions/search', ProductosController.isSearchUser);
router.post('/permissions/ticket', ProductosController.isTicketUser);
router.post('/search-card', ProductosController.getProductCard);
router.get('/marcas-codigos-clasificacion', ProductosController.getMarcasAndCodigosClasificacion);


export default router;
