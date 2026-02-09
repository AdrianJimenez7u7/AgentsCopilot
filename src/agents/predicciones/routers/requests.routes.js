import express from "express";
import { RequestsController } from "../controllers/requests.controller.js";

const router = express.Router();

router.get("/", RequestsController.getAll);
router.post("/", RequestsController.postAction);
router.delete("/", RequestsController.deleteById);

export default router;
