import express from "express";
import { ModelosController } from "../controllers/modelos.controller.js";
// import { requireRole } from "../middleware/requireRole.js";

const router = express.Router();

router.get("/", ModelosController.list);
router.get("/:slug", ModelosController.getBySlug);

// Admin-only (actívalo luego)
// router.post("/", requireRole("admin"), ModelosController.create);
// router.patch("/:slug", requireRole("admin"), ModelosController.update);
// router.delete("/:slug", requireRole("admin"), ModelosController.remove);

router.post("/", ModelosController.create);
router.patch("/:slug", ModelosController.update);
router.delete("/:slug", ModelosController.remove);

export default router;
