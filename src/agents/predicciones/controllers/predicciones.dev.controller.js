// controllers/predicciones.dev.controller.js
import { PrediccionesDevService } from "../services/predicciones.dev.service.js";
import { successResponse, errorResponse } from "../../../shared/utils/response.js";

export class PrediccionesDevController {
  static async diagDb(req, res) {
    try {
      const info = await PrediccionesDevService.getDiagDb();
      return successResponse(res, { ok: true, ...info });
    } catch (e) {
      return errorResponse(res, e?.message ?? "Error en diag.", 500);
    }
  }

  static async listArchivosDev(req, res) {
    try {
      const modeloSlug = (req.query.modeloSlug ?? undefined)?.toString().trim() || undefined;
      const mesObjetivo = (req.query.mesObjetivo ?? undefined)?.toString().trim() || undefined;
      const tipo = (req.query.tipo ?? undefined)?.toString().trim() || undefined;
      const topRaw = Number(req.query.top ?? "200");
      const top = Number.isFinite(topRaw) ? topRaw : 200;

      const rows = await PrediccionesDevService.listArchivosDev({
        modeloSlug,
        mesObjetivo,
        tipo,
        top,
      });

      return successResponse(res, { ok: true, rows });
    } catch (e) {
      return errorResponse(res, e?.message ?? "Error listando archivos DEV.", 500);
    }
  }

  static async deleteArchivoDev(req, res) {
    try {
      // soporta /archivos/:id y opcional query ?id=
      const id =
        (req.params.id ?? "").toString().trim() ||
        (req.query.id ?? "").toString().trim();

      if (!id) return errorResponse(res, "ID de archivo requerido", 400);

      await PrediccionesDevService.deleteArchivoById(id);

      return successResponse(res, { ok: true, message: "Archivo eliminado correctamente" });
    } catch (e) {
      return errorResponse(res, e?.message ?? "Error eliminando archivo.", 500);
    }
  }

  static async uploadArchivoDev(req, res) {
    try {
      const modeloSlug = String(req.body.modeloSlug ?? "").trim();
      const mesObjetivo = String(req.body.mesObjetivo ?? "").trim();
      const tipo = String(req.body.tipo ?? "infer-output").trim();
      const estado = String(req.body.estado ?? "Preparada").trim();

      const isLocked = String(req.body.isLocked ?? "true") === "true";
      const notes = String(req.body.notes ?? "").trim() || null;
      const uploadedBy = String(req.body.uploadedBy ?? "DEV").trim();

      const file = req.file; // multer
      if (!modeloSlug || !mesObjetivo || !file?.buffer) {
        return errorResponse(res, "modeloSlug, mesObjetivo y file son requeridos.", 400);
      }

      const archivoId = await PrediccionesDevService.insertArchivo({
        tipo,
        modeloSlug,
        mesObjetivo,
        uploadedByUserId: uploadedBy,
        fileName: file.originalname,
        contentType: file.mimetype || null,
        fileSizeBytes: file.size,
        fileContent: file.buffer,
        meta: { isLocked, notes, estado },
      });

      return successResponse(res, { ok: true, archivoId });
    } catch (e) {
      return errorResponse(res, e?.message ?? "Error subiendo archivo.", 500);
    }
  }
}
