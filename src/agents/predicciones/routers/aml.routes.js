import express from "express";
import { uploadCsvMiddleware } from "../middlewares/uploadCsv.middleware.js";
import { AmlController } from "../controllers/aml.controller.js";

const router = express.Router();

// Inferencia y resultados
router.post("/gastos/infer", uploadCsvMiddleware(), AmlController.inferGastos);
router.get("/jobs/:jobName/status", AmlController.jobStatus);
router.get("/gastos/result/:jobKey", AmlController.downloadGastosResult);

// Catálogo: deployments y modelos
router.get("/batch-endpoints", AmlController.getBatchEndpoints);
router.get("/batch-endpoints/:endpointName", AmlController.getBatchEndpointDetails);
router.get("/batch/:endpointName/deployments", AmlController.getDeployments);
router.get("/online-endpoints", AmlController.getOnlineEndpoints);
router.get("/models", AmlController.getModels);
router.get("/models/:modelName/versions", AmlController.getModelVersions);

export default router;
