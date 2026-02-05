// src/predicciones/services/archivos.service.js
import { ArchivosData } from "../data/archivos.data.js";

function isUuid(v) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || "").trim());
}

function safeJsonParse(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function toIso(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isFinite(dt.getTime()) ? dt.toISOString() : null;
}

function bigIntToNumberOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v); // file sizes no deberían overflow
  if (typeof v === "number") return v;
  return Number(v);
}

export class ArchivosService {
  static async insertArchivo(params) {
    const created = await ArchivosData.create({
      Tipo: String(params.tipo),
      ModeloSlug: params.modeloSlug ?? null,
      MesObjetivo: params.mesObjetivo ?? null,
      UploadedByUserId: params.uploadedByUserId ?? null,
      FileName: String(params.fileName),
      ContentType: params.contentType ?? null,
      FileSizeBytes: params.fileSizeBytes ?? null,
      FileContent: params.fileContent, // Buffer ok
      HashSha256: params.hashSha256 ?? null,
      MetaJson: params.metaJson ?? null,
      CreatedAt: new Date(),
    });

    return String(created.Id);
  }

  static async listArchivosDev(params = {}) {
    const top = Math.min(Math.max(Number(params.top ?? 200), 1), 500);

    // default: infer-*, metrics, actuals si no mandas tipo (igual que tu SQL)
    const where = {
      AND: [
        params.modeloSlug ? { ModeloSlug: params.modeloSlug } : {},
        params.mesObjetivo ? { MesObjetivo: params.mesObjetivo } : {},
        params.tipo
          ? { Tipo: params.tipo }
          : {
              OR: [
                { Tipo: { startsWith: "infer-" } },
                { Tipo: "metrics" },
                { Tipo: "actuals" },
              ],
            },
      ],
    };

    const rows = await ArchivosData.findMany(where, { take: top });

    // Match shape que ya usabas en Next
    return rows.map((r) => ({
      id: String(r.Id),
      tipo: r.Tipo,
      modeloSlug: r.ModeloSlug ?? null,
      mesObjetivo: r.MesObjetivo ?? null,
      uploadedByUserId: r.UploadedByUserId ?? null,
      fileName: r.FileName,
      contentType: r.ContentType ?? null,
      fileSizeBytes: bigIntToNumberOrNull(r.FileSizeBytes),
      createdAt: toIso(r.CreatedAt),
      metaJson: r.MetaJson ?? null,
    }));
  }

  static async downloadArchivoById(id) {
    const cleaned = String(id ?? "").trim();
    if (!isUuid(cleaned)) return null;

    const row = await ArchivosData.findFileById(cleaned);
    if (!row) return null;

    return {
      fileName: row.FileName,
      contentType: row.ContentType || "application/octet-stream",
      fileContent: row.FileContent, // Buffer
    };
  }

  static async updateMetaJsonById({ id, metaJson }) {
    const cleaned = String(id ?? "").trim();
    if (!isUuid(cleaned)) return;
    await ArchivosData.updateMetaById(cleaned, metaJson);
  }

  static async deleteArchivoById(id) {
    const cleaned = String(id ?? "").trim();
    if (!isUuid(cleaned)) return;

    try {
      await ArchivosData.deleteById(cleaned);
    } catch {
      // idempotente: si no existe, no truena
    }
  }

  // Helpers para inferencias
  static safeParseMeta(metaJson) {
    return safeJsonParse(metaJson) ?? {};
  }
}
