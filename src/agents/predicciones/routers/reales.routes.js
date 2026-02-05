import express from "express";
import multer from "multer";
import { RealesController } from "../controllers/reales.controller.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

router.get("/existe", RealesController.existe);
router.post("/upload", upload.single("file"), RealesController.upload);

export default router;
