export const MODEL_SLUGS = ["ingresos", "gastos", "costo-ventas"];

export function normalizeModelSlug(slug) {
  const s = String(slug ?? "").trim().toLowerCase();
  if (s === "costoventas") return "costo-ventas";
  return s;
}
