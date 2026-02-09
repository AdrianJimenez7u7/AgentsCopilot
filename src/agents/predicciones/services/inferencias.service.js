import { InferenciasData } from "../data/inferencias.data.js";

const TIPO_INFER_OUTPUT = "infer-output";

function safeJsonParse(s) {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}

export class InferenciasService {
  static async listInferenciasUsuario({ modeloSlug }) {
    return InferenciasData.listInferenciasUsuario({ modeloSlug });
  }

  // ✅ NUEVO: agrupa por modelo las inferencias desbloqueadas
  static async listMisDesbloqueadas({ userId }) {
    const rows = await InferenciasData.listUnlockedInferOutputs({ userId });

    const grouped = {};
    for (const row of rows ?? []) {
      const slug = String(row.ModeloSlug ?? "").toLowerCase();
      if (!slug) continue;

      const meta = safeJsonParse(row.MetaJson);
      const fileSizeBytes = meta?.fileSizeBytes ?? null;

      grouped[slug] = grouped[slug] ?? [];
      grouped[slug].push({
        mesObjetivo: row.MesObjetivo,
        archivoId: row.archivoId,
        fileName: row.FileName,
        fileSizeBytes,
        createdAt: row.CreatedAt,
        metaJson: row.MetaJson,
        uploadedBy: row.UploadedByUserId,
      });
    }

    return grouped;
  }

  static async getPrecargadaStatus({ modeloSlug, mesObjetivo }) {
    const row = await InferenciasData.findLatestByModeloMesTipo({
      modeloSlug,
      mesObjetivo,
      tipo: TIPO_INFER_OUTPUT,
      select: { Id: true, MetaJson: true },
    });

    if (!row) return { exists: false };

    const meta = safeJsonParse(row.MetaJson);
    const isLocked = meta?.isLocked ?? null;

    return {
      exists: true,
      id: row.Id,
      isLocked: isLocked === null ? true : !!isLocked,
    };
  }

  static async desbloquearPrecargada({ modeloSlug, mesObjetivo, userId }) {
    const row = await InferenciasData.findLatestByModeloMesTipo({
      modeloSlug,
      mesObjetivo,
      tipo: TIPO_INFER_OUTPUT,
      select: { Id: true, MetaJson: true },
    });

    if (!row) {
      const err = new Error(`No existe inferencia precargada (infer-output) para ${modeloSlug} ${mesObjetivo}.`);
      err.statusCode = 404;
      throw err;
    }

    const meta = safeJsonParse(row.MetaJson);
    meta.isLocked = false;
    meta.unlockedAt = new Date().toISOString();
    if (userId) meta.unlockedByUserId = userId;

    await InferenciasData.updateMetaJson(row.Id, JSON.stringify(meta));

    return { id: row.Id, modeloSlug, mesObjetivo, meta };
  }

  static async listDisponibles({ modeloSlug }) {
    return InferenciasData.listDisponibles({ modeloSlug, tipo: TIPO_INFER_OUTPUT });
  }

  static async existeDisponible({ modeloSlug, mesObjetivo }) {
    const row = await InferenciasData.findLatestByModeloMesTipo({
      modeloSlug,
      mesObjetivo,
      tipo: TIPO_INFER_OUTPUT,
      select: { Id: true, MetaJson: true },
    });

    if (!row) return false;

    const meta = safeJsonParse(row.MetaJson);
    const isLocked = meta?.isLocked;

    // misma lógica “disponibles”: si no hay isLocked, se considera disponible
    if (isLocked === undefined || isLocked === null) return true;
    return isLocked === false;
  }
}
