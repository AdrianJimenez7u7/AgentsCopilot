import { Router } from "express";
import { chat } from "../controllers/copilot.controller.js";
import { copilotActivityController } from "../controllers/activity.controller.js";

const router = Router();

// Rutas con nombre de agente dinámico
// POST /agente/copilot/:agentName/chat
router.post("/:agentName/chat", chat);

// POST /agente/copilot/:agentName/activity
router.post("/:agentName/activity", copilotActivityController);

// Rutas por defecto (usa el agente por defecto)
// POST /agente/copilot/chat
router.post("/chat", chat);

// POST /agente/copilot/activity
router.post("/activity", copilotActivityController);

export default router;