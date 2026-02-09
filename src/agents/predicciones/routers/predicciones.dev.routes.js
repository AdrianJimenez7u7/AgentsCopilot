// routes/predicciones.dev.routes.js
import express from "express";
import multer from "multer";
import { PrediccionesDevController } from "../controllers/predicciones.dev.controller.js";
// import { requireRole } from "../middleware/requireRole.js"; // opcional si dev es admin-only

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB, ajusta
});

// ✅ diag (health-check)
router.get("/diag", PrediccionesDevController.diagDb);

// ✅ listado “precargada” (unificado)
router.get("/archivos", PrediccionesDevController.listArchivosDev);

// ✅ delete (antes DELETE con query ?id=)
router.delete("/archivos/:id", PrediccionesDevController.deleteArchivoDev);
// opcional compat:
// router.delete("/archivos", PrediccionesDevController.deleteArchivoDev);

// ✅ upload (antes /dev/upload)
router.post("/archivos", upload.single("file"), PrediccionesDevController.uploadArchivoDev);

export default router;
