import { RequestsService } from "../services/requests.service.js";

export class RequestsController {
  static async getAll(req, res) {
    try {
      const requests = await RequestsService.getAll();
      return res.json({ ok: true, requests });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message ?? "Error leyendo requests." });
    }
  }

  static async postAction(req, res) {
    try {
      const out = await RequestsService.handleAction(req.body ?? {});
      return res.json(out);
    } catch (e) {
      const code = e?.statusCode || 500;
      return res.status(code).json({ ok: false, error: e?.message ?? "Error en request action." });
    }
  }

  static async deleteById(req, res) {
    try {
      const id = String(req.query.id ?? "").trim();
      if (!id) return res.status(400).json({ ok: false, error: "Missing ID" });

      await RequestsService.deleteById(id);
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message ?? "Error borrando request." });
    }
  }
}
