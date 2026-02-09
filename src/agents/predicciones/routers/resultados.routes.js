import express from "express";
import { ResultadosController } from "../controllers/resultados.controller.js";

const router = express.Router();

router.get("/prediccion", ResultadosController.getPrediccionRows);

export default router;
