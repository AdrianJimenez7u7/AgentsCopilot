// src/predicciones/services/inferenciasUsuario.service.js
import { ArchivosData } from "../data/archivos.data.js";
import { ArchivosService } from "./archivos.service.js";

function toIso(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isFinite(dt.getTime()) ? dt.toISOString() : null;
}

function bigIntToNumberOrNull(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number") return v;
  return Number(v);
}

export async function listInferenciasUsuario(params = {}) {
  const modeloSlug = params.modeloSlug ? String(params.modeloSlug).trim() : null;

  const rows = await ArchivosData.findManyByModelAndMonths(
    {
      AND: [
        { ModeloSlug: { not: null } },
        { MesObjetivo: { not: null } },
        modeloSlug ? { ModeloSlug: modeloSlug } : {},
        {
          OR: [{ Tipo: "infer-output" }, { Tipo: "metrics" }, { Tipo: "actuals" }],
        },
      ],
    },
    500
  );

  // Agrupar por (modeloSlug, mesObjetivo)
  const map = new Map();

  for (const r of rows) {
    const slug = String(r.ModeloSlug || "").toLowerCase();
    const mes = String(r.MesObjetivo || "");
    if (!slug || !mes) continue;

    const key = `${slug}|${mes}`;
    if (!map.has(key)) {
      map.set(key, {
        modeloSlug: slug,
        mesObjetivo: mes,
        output: null,
        metrics: null,
        actuals: null,
        updatedAt: null,
      });
    }

    const item = map.get(key);

    // track updatedAt = max CreatedAt
    const createdIso = toIso(r.CreatedAt);
    if (!item.updatedAt || (createdIso && createdIso > item.updatedAt)) item.updatedAt = createdIso;

    // elegir latest por tipo (rows ya vienen ordered pero por seguridad comparamos)
    const pick = (current, candidate) => {
      if (!candidate) return current;
      if (!current) return candidate;
      const c1 = current.CreatedAt instanceof Date ? current.CreatedAt : new Date(current.CreatedAt);
      const c2 = candidate.CreatedAt instanceof Date ? candidate.CreatedAt : new Date(candidate.CreatedAt);
      return c2 > c1 ? candidate : current;
    };

    if (r.Tipo === "infer-output") item.output = pick(item.output, r);
    if (r.Tipo === "metrics") item.metrics = pick(item.metrics, r);
    if (r.Tipo === "actuals") item.actuals = pick(item.actuals, r);
  }

  // Construir shape final
  const out = [];
  for (const item of map.values()) {
    const output = item.output;
    if (!output) continue; // si no hay infer-output, no es una inferencia útil

    const meta = ArchivosService.safeParseMeta(output.MetaJson);
    const isLocked = meta?.isLocked;
    const lockedFinal = isLocked === null || isLocked === undefined ? true : !!isLocked;

    out.push({
      id: String(output.Id),
      modeloSlug: item.modeloSlug,
      mesObjetivo: item.mesObjetivo,
      isLocked: lockedFinal,
      outputArchivoId: String(output.Id),
      metricsArchivoId: item.metrics ? String(item.metrics.Id) : null,
      actualsArchivoId: item.actuals ? String(item.actuals.Id) : null,
      summaryJson: meta?.summary ?? meta?.summaryJson ?? null,
      createdAt: toIso(output.CreatedAt),
      updatedAt: item.updatedAt,
      // extras útiles si tu UI los ocupa
      outputFileName: output.FileName,
      outputFileSizeBytes: bigIntToNumberOrNull(output.FileSizeBytes),
    });
  }

  // Orden: Mes desc (ya viene así por el query, pero aquí lo aseguramos)
  out.sort((a, b) => String(b.mesObjetivo).localeCompare(String(a.mesObjetivo)));

  return out;
}

export async function unlockInferencia(params) {
  const modeloSlug = String(params.modeloSlug ?? "").trim();
  const mesObjetivo = String(params.mesObjetivo ?? "").trim();
  const userId = String(params.userId ?? "").trim();

  if (!modeloSlug || !/^\d{4}-\d{2}$/.test(mesObjetivo)) return 0;

  // 1) Encontrar el infer-output más reciente
  const row = await ArchivosData.findLatestByTipo(modeloSlug, mesObjetivo, "infer-output");
  if (!row) return 0;

  // 2) Update MetaJson.isLocked=false
  const meta = ArchivosService.safeParseMeta(row.MetaJson);
  meta.isLocked = false;
  meta.unlockedAt = new Date().toISOString();
  if (userId) meta.unlockedByUserId = userId;

  await ArchivosData.updateMetaById(String(row.Id), JSON.stringify(meta));
  return 1;
}
