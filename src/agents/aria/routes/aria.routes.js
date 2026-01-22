import express from 'express';
import { AriaController } from '../controllers/aria.controller.js';

const router = express.Router();

router.post('/analyze-date', AriaController.analyzeDate);

export default router;