import { invokeGastosBatch, getJobStatus } from "../services/aml.service.js";
import { downloadOutputCsv } from "../services/blob.service.js";
import { 
  getBatchEndpointDetails,
  listBatchEndpoints, 
  listOnlineEndpoints,
  listBatchDeployments, 
  listModelContainers, 
  listModelVersions 
} from "../services/aml.catalog.service.js";

export class AmlController {
  static async inferGastos(req, res) {
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({ ok: false, message: "Falta el archivo CSV (form-data key: file)." });
      }

      // Leer endpoint y deployment de query params o form-data (fallback a env vars)
      const endpoint = req.query.endpoint || req.body?.endpoint || process.env.AML_ENDPOINT || null;
      const deployment = req.query.deployment || req.body?.deployment || process.env.AML_DEPLOYMENT || null;

      const result = await invokeGastosBatch({ 
        csvBuffer: req.file.buffer,
        endpoint,
        deployment,
      });

      return res.json({
        ok: true,
        ...result,
      });
    } catch (e) {
      return res.status(e.statusCode || 500).json({
        ok: false,
        message: e.message,
        details: e.details,
      });
    }
  }

  static async jobStatus(req, res) {
    try {
      const { jobName } = req.params;
      const info = await getJobStatus(jobName);
      return res.json({ ok: true, ...info });
    } catch (e) {
      return res.status(e.statusCode || 500).json({ ok: false, message: e.message, details: e.details });
    }
  }

  static async downloadGastosResult(req, res) {
    try {
      const { jobKey } = req.params;
      const outputPrefixBase = process.env.AML_OUTPUT_PREFIX || "web-inference/outputs";
      const outputPrefix = `${outputPrefixBase}/${jobKey}`;
      const outputFileName = process.env.AML_OUTPUT_FILENAME || "predicciones_gastos_un_sucursal.csv";

      const { foundBlobName, stream } = await downloadOutputCsv({
        outputPrefix,
        outputFileName,
      });

      if (!stream) {
        return res.status(500).json({ ok: false, message: "No fue posible leer el archivo de salida." });
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${outputFileName}"`);
      res.setHeader("X-Blob-Name", foundBlobName);

      return stream.pipe(res);
    } catch (e) {
      return res.status(e.statusCode || 500).json({ ok: false, message: e.message });
    }
  }

  // === Catálogo: Deployments y Modelos ===

  static async getBatchEndpointDetails(req, res) {
    try {
      const endpointName = req.params.endpointName;
      const data = await getBatchEndpointDetails(endpointName);
      res.json({ ok: true, endpoint: data });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message, details: e.response?.data });
    }
  }

  static async getBatchEndpoints(req, res) {
    try {
      const data = await listBatchEndpoints();
      res.json({ ok: true, endpoints: data });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message, details: e.response?.data });
    }
  }

  static async getOnlineEndpoints(req, res) {
    try {
      const data = await listOnlineEndpoints();
      res.json({ ok: true, endpoints: data });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message, details: e.response?.data });
    }
  }

  static async getDeployments(req, res) {
    try {
      const endpointName = req.params.endpointName;
      const data = await listBatchDeployments(endpointName);
      res.json({ ok: true, endpointName, deployments: data });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message, details: e.response?.data });
    }
  }

  static async getModels(req, res) {
    try {
      const data = await listModelContainers();
      res.json({ ok: true, models: data });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message, details: e.response?.data });
    }
  }

  static async getModelVersions(req, res) {
    try {
      const modelName = req.params.modelName;
      const data = await listModelVersions(modelName);
      res.json({ ok: true, modelName, versions: data });
    } catch (e) {
      res.status(500).json({ ok: false, message: e.message, details: e.response?.data });
    }
  }
}
