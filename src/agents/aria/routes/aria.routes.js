import express from 'express';
import { AriaController } from '../controllers/aria.controller.js';

const router = express.Router();

router.post('/analyze-date', AriaController.analyzeDate);
router.get('/get-stats', AriaController.getDashboardStats);
router.get('/get-history', AriaController.getHistory);
router.get('/get-chat/:sessionId', AriaController.getChatDetail);
router.get('/get-users', AriaController.getSystemUsers);

// Configuración de Multer para manejo de archivos en memoria
import multer from 'multer';
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // Límite 5MB
});

// Rutas de Archivos
router.post('/upload', upload.single('file'), AriaController.uploadFile);
router.get('/file/:id', AriaController.getFile);

export default router;