import express from "express";
import { ArchivosController } from "../controllers/archivos.controller.js";

const router = express.Router();

// ✅ Descargar binario (xlsx/csv) por ID
router.get("/:id", ArchivosController.downloadById);

export default router;