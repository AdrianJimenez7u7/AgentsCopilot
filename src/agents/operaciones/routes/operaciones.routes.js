import express from 'express';
import { ProductosController } from '../controllers/productos.controller.js';

const router = express.Router();

router.post('/search', ProductosController.extractProductData);
router.post('/search/file', ProductosController.uploadXLSX, ProductosController.extractSKUfromXLSX);
router.get('/search/pending-validations', ProductosController.getPendingValidations);
router.put('/search/validate/:id', ProductosController.updateValidationStatus);
router.get('/search/all-products', ProductosController.getAllProducts);
router.post('/search/validate-card', ProductosController.validateFromCard);
router.post('/permissions', ProductosController.getPermissions);
router.post('/permissions/search', ProductosController.isSearchUser);
router.post('/permissions/ticket', ProductosController.isTicketUser);
router.post('/search-card', ProductosController.getProductCard);
router.get('/marcas-codigos-clasificacion', ProductosController.getMarcasAndCodigosClasificacion);
router.delete('/search/pending/:id', ProductosController.deletePendingProduct);

// ── TEST: clasificación con modelo de razonamiento gpt-5-mini ──────────────
router.post('/clasificar-test', ProductosController.clasificarProductoTest);

router.post('/my-data', ProductosController.getMyData);

router.get('/products-from-sharepoint-list', ProductosController.getProductsFromSharepointList);
router.get('/sharepoint-list-metadata', ProductosController.getSharepointListMetadata);

router.post('/user-by-purchase-order', ProductosController.getUserByPurchaseOrder);


export default router;
