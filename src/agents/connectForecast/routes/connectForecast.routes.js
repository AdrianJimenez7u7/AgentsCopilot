import express from 'express';
import { ConnectForecastController } from '../controllers/connectForecast.controller.js';

const router = express.Router();

router.post('/query', ConnectForecastController.query);

export default router;
