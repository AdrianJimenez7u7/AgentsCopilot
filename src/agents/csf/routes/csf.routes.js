import express from 'express';
import { CsfController } from '../controllers/csf.controller.js';

const router = express.Router();

router.post('/extraer', CsfController.extraer);

export default router;
