import { ResultadosService } from "../services/resultados.service.js";

export class ResultadosController {
  static async getPrediccionRows(req, res) {
    try {
      const modeloSlug = String(req.query.modeloSlug ?? "").trim();
      const mesObjetivo = String(req.query.mesObjetivo ?? "").trim();

      if (!modeloSlug) return res.status(400).json({ ok: false, error: "modeloSlug requerido" });
      if (!/^\d{4}-\d{2}$/.test(mesObjetivo)) {
        return res.status(400).json({ ok: false, error: "mesObjetivo inválido (YYYY-MM)" });
      }

      const out = await ResultadosService.getPrediccionRows({ modeloSlug, mesObjetivo });
      return res.json({ ok: true, ...out });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message ?? "Error" });
    }
  }
}
