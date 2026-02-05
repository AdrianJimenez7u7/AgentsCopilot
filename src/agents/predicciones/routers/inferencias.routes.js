import express from "express";
import { InferenciasController } from "../controllers/inferencias.controller.js";

const router = express.Router();

// Existente
router.get("/", InferenciasController.listInferenciasUsuario);

// ✅ NUEVO: mis inferencias desbloqueadas agrupadas por modelo
router.get("/mis", InferenciasController.listMisDesbloqueadas);

// Existentes
router.get("/precargada", InferenciasController.getPrecargadaStatus);
router.post("/precargada/desbloquear", InferenciasController.desbloquearPrecargada);

router.get("/disponibles", InferenciasController.listDisponibles);
router.get("/existe", InferenciasController.existeDisponible);

export default router;
