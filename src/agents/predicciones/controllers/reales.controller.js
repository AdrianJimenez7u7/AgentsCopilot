import { RealesService } from "../services/reales.service.js";

export class RealesController {
  static async existe(req, res) {
    try {
      const modeloSlug = String(req.query.modeloSlug ?? "").trim();
      const mesObjetivo = String(req.query.mesObjetivo ?? "").trim();

      if (!modeloSlug || !mesObjetivo) {
        return res.status(400).json({ ok: false, error: "modeloSlug y mesObjetivo son requeridos." });
      }

      const { exists, archivoId } = await RealesService.existe({ modeloSlug, mesObjetivo });
      return res.json({ ok: true, exists, archivoId });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message ?? "Error consultando reales." });
    }
  }

  static async upload(req, res) {
    try {
      const modeloSlug = String(req.body.modeloSlug ?? "").trim();
      const mesObjetivo = String(req.body.mesObjetivo ?? "").trim();

      if (!req.file?.buffer) return res.status(400).json({ ok: false, error: "Archivo requerido." });
      if (!modeloSlug) return res.status(400).json({ ok: false, error: "modeloSlug requerido." });
      if (!/^\d{4}-\d{2}$/.test(mesObjetivo)) {
        return res.status(400).json({ ok: false, error: "mesObjetivo inválido. Esperado YYYY-MM." });
      }

      const id = await RealesService.upload({
        modeloSlug,
        mesObjetivo,
        fileName: req.file.originalname,
        contentType: req.file.mimetype || "application/octet-stream",
        fileContent: req.file.buffer,
        uploadedByUserId: String(req.body.uploadedBy ?? "").trim() || null,
      });

      return res.json({
        ok: true,
        id,
        fileName: req.file.originalname,
        mesObjetivo,
        modeloSlug,
        tipo: "actuals",
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message ?? "Error subiendo reales." });
    }
  }
}
