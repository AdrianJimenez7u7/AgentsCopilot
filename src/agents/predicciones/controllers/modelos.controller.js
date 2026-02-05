import { ModelosService } from "../services/modelos.service.js";

export class ModelosController {
  static async list(req, res) {
    try {
      const rows = await ModelosService.list();
      return res.json({ ok: true, rows });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message ?? "Error listando modelos." });
    }
  }

  static async getBySlug(req, res) {
    try {
      const slug = String(req.params.slug ?? "").trim();
      if (!slug) return res.status(400).json({ ok: false, error: "slug requerido." });

      const row = await ModelosService.getBySlug(slug);
      if (!row) return res.status(404).json({ ok: false, error: "Modelo no encontrado." });

      return res.json({ ok: true, row });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message ?? "Error obteniendo modelo." });
    }
  }

  static async create(req, res) {
    try {
      const body = req.body ?? {};
      const created = await ModelosService.create(body);
      return res.status(201).json({ ok: true, row: created });
    } catch (e) {
      const code = e?.statusCode || 500;
      return res.status(code).json({ ok: false, error: e?.message ?? "Error creando modelo." });
    }
  }

  static async update(req, res) {
    try {
      const slug = String(req.params.slug ?? "").trim();
      if (!slug) return res.status(400).json({ ok: false, error: "slug requerido." });

      const body = req.body ?? {};
      const updated = await ModelosService.update(slug, body);
      return res.json({ ok: true, row: updated });
    } catch (e) {
      const code = e?.statusCode || 500;
      return res.status(code).json({ ok: false, error: e?.message ?? "Error actualizando modelo." });
    }
  }

  static async remove(req, res) {
    try {
      const slug = String(req.params.slug ?? "").trim();
      if (!slug) return res.status(400).json({ ok: false, error: "slug requerido." });

      await ModelosService.remove(slug);
      return res.json({ ok: true });
    } catch (e) {
      const code = e?.statusCode || 500;
      return res.status(code).json({ ok: false, error: e?.message ?? "Error eliminando modelo." });
    }
  }
}
