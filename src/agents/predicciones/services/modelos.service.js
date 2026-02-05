import { ModelosData } from "../data/modelos.data.js";

function safeJsonParse(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

export class ModelosService {
  static async list() {
    const rows = await ModelosData.list();
    return rows.map(r => ({
      id: r.Id,
      slug: r.Slug,
      nombre: r.Nombre,
      estado: r.Estado,
      versionActual: r.VersionActual,
      descripcion: r.Descripcion,
      config: safeJsonParse(r.ConfigJson) ?? {},
      createdAt: r.CreatedAt,
      updatedAt: r.UpdatedAt,
    }));
  }

  static async getBySlug(slug) {
    const r = await ModelosData.getBySlug(slug);
    if (!r) return null;
    return {
      id: r.Id,
      slug: r.Slug,
      nombre: r.Nombre,
      estado: r.Estado,
      versionActual: r.VersionActual,
      descripcion: r.Descripcion,
      config: safeJsonParse(r.ConfigJson) ?? {},
      createdAt: r.CreatedAt,
      updatedAt: r.UpdatedAt,
    };
  }

  static async create(body) {
    const slug = String(body.slug ?? "").trim();
    const nombre = String(body.nombre ?? "").trim();
    if (!slug) { const e = new Error("slug requerido."); e.statusCode = 400; throw e; }
    if (!nombre) { const e = new Error("nombre requerido."); e.statusCode = 400; throw e; }

    const payload = {
      Slug: slug,
      Nombre: nombre,
      Estado: String(body.estado ?? "ACTIVO").trim(),
      VersionActual: body.versionActual ? String(body.versionActual).trim() : null,
      Descripcion: body.descripcion ? String(body.descripcion).trim() : null,
      ConfigJson: body.config ? JSON.stringify(body.config) : null,
    };

    // Evitar duplicado por slug
    const exists = await ModelosData.getBySlug(slug);
    if (exists) { const e = new Error("Ya existe un modelo con ese slug."); e.statusCode = 409; throw e; }

    return ModelosData.create(payload);
  }

  static async update(slug, body) {
    const current = await ModelosData.getBySlug(slug);
    if (!current) { const e = new Error("Modelo no encontrado."); e.statusCode = 404; throw e; }

    const patch = {};
    if (body.nombre !== undefined) patch.Nombre = String(body.nombre ?? "").trim();
    if (body.estado !== undefined) patch.Estado = String(body.estado ?? "").trim();
    if (body.versionActual !== undefined) patch.VersionActual = body.versionActual ? String(body.versionActual).trim() : null;
    if (body.descripcion !== undefined) patch.Descripcion = body.descripcion ? String(body.descripcion).trim() : null;
    if (body.config !== undefined) patch.ConfigJson = body.config ? JSON.stringify(body.config) : null;

    return ModelosData.updateBySlug(slug, patch);
  }

  static async remove(slug) {
    const current = await ModelosData.getBySlug(slug);
    if (!current) { const e = new Error("Modelo no encontrado."); e.statusCode = 404; throw e; }
    await ModelosData.deleteBySlug(slug);
  }
}
