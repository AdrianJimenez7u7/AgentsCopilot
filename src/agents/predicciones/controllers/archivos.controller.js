import { ArchivosData } from "../data/archivos.data.js";

function safeFileName(name) {
  const n = String(name || "archivo").trim();
  // Quita caracteres peligrosos en header
  return n.replace(/[\r\n"]/g, "").slice(0, 200);
}

export class ArchivosController {
  static async downloadById(req, res) {
    try {
      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ ok: false, error: "id requerido" });

      const row = await ArchivosData.findFileById(id);
      if (!row || !row.FileContent) {
        return res.status(404).json({ ok: false, error: "Archivo no encontrado" });
      }

      const fileName = safeFileName(row.FileName);
      const contentType = row.ContentType || "application/octet-stream";

      // Headers para download
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

      // Opcional: evitar cache en browser intermedio
      res.setHeader("Cache-Control", "no-store");

      return res.status(200).send(row.FileContent);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message ?? "Error" });
    }
  }
}