import { InferenciasService } from "../services/inferencias.service.js";

export class InferenciasController {
  static async listInferenciasUsuario(req, res) {
    try {
      const modeloSlug = (req.query.modeloSlug ?? undefined)?.toString().trim() || undefined;
      const rows = await InferenciasService.listInferenciasUsuario({ modeloSlug });
      return res.json({ ok: true, rows });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message ?? "Error listando inferencias." });
    }
  }

  // ✅ NUEVO: /inferencias/mis
  static async listMisDesbloqueadas(req, res) {
    try {
      // Mantengo tu param userId, pero ahora sí se usa (si viene)
      const userIdRaw = String(req.query.userId ?? "").trim();

      // Para no romperte si antes mandabas "USER" por default:
      const userId = userIdRaw && userIdRaw !== "USER" ? userIdRaw : null;

      const grouped = await InferenciasService.listMisDesbloqueadas({ userId });
      return res.json({ ok: true, grouped });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message ?? "Error listando mis predicciones." });
    }
  }

  static async getPrecargadaStatus(req, res) {
    try {
      const modeloSlug = String(req.query.modeloSlug ?? "").trim();
      const mesObjetivo = String(req.query.mesObjetivo ?? "").trim();

      if (!modeloSlug) return res.status(400).json({ ok: false, error: "modeloSlug requerido." });
      if (!/^\d{4}-\d{2}$/.test(mesObjetivo)) {
        return res.status(400).json({ ok: false, error: "mesObjetivo inválido (YYYY-MM)." });
      }

      const status = await InferenciasService.getPrecargadaStatus({ modeloSlug, mesObjetivo });
      return res.json({ ok: true, ...status });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message ?? "Error." });
    }
  }

  static async desbloquearPrecargada(req, res) {
    try {
      const body = req.body ?? {};
      const modeloSlug = String(body?.modeloSlug ?? "").trim();
      const mesObjetivo = String(body?.mesObjetivo ?? "").trim();
      const userId = String(body?.userId ?? "").trim();

      if (!modeloSlug) return res.status(400).json({ ok: false, error: "modeloSlug requerido." });
      if (!/^\d{4}-\d{2}$/.test(mesObjetivo)) {
        return res.status(400).json({ ok: false, error: "mesObjetivo inválido. Usa YYYY-MM." });
      }

      const out = await InferenciasService.desbloquearPrecargada({
        modeloSlug,
        mesObjetivo,
        userId: userId || null,
      });

      return res.json({ ok: true, ...out });
    } catch (e) {
      const code = e?.statusCode || 500;
      return res.status(code).json({ ok: false, error: e?.message ?? "Error desbloqueando inferencia." });
    }
  }

  static async listDisponibles(req, res) {
    try {
      const modeloSlug = String(req.query.modeloSlug ?? "").trim();
      if (!modeloSlug) return res.status(400).json({ ok: false, error: "modeloSlug es requerido." });

      const items = await InferenciasService.listDisponibles({ modeloSlug });
      return res.json({ ok: true, items });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message ?? "Error listando inferencias." });
    }
  }

  static async existeDisponible(req, res) {
    try {
      const modeloSlug = String(req.query.modeloSlug ?? "").trim();
      const anio = Number(req.query.anio ?? "");
      const mes = Number(req.query.mes ?? "");

      if (!modeloSlug || !Number.isFinite(anio) || !Number.isFinite(mes)) {
        return res.status(400).json({ ok: false, error: "modeloSlug, anio, mes son requeridos." });
      }

      const mesObjetivo = `${anio}-${String(mes).padStart(2, "0")}`;
      const exists = await InferenciasService.existeDisponible({ modeloSlug, mesObjetivo });

      return res.json({ ok: true, exists, mesObjetivo });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message ?? "Error consultando disponibilidad." });
    }
  }
}
