// services/predicciones.dev.service.js
import crypto from "crypto";
import { PrediccionesDevData } from "../data/predicciones.dev.data.js";

export class PrediccionesDevService {
  static async getDiagDb() {
    return PrediccionesDevData.getDiagDb();
  }

  static async listArchivosDev({ modeloSlug, mesObjetivo, tipo, top = 200 }) {
    const rawRows = await PrediccionesDevData.listArchivos({ modeloSlug, mesObjetivo, tipo, top });

    return rawRows.map((r) => {
      let meta = {};
      try {
        meta = r.MetaJson ? JSON.parse(r.MetaJson) : {};
      } catch {
        meta = {};
      }

      const lockedFinal = meta?.isLocked === undefined || meta?.isLocked === null ? true : !!meta.isLocked;

      return {
        id: r.Id,
        modeloSlug: r.ModeloSlug,
        mesObjetivo: r.MesObjetivo,
        tipo: r.Tipo,
        isLocked: lockedFinal,
        outputArchivoId: r.Id, // como tu código
        createdAt: r.CreatedAt,
        usuario: r.UploadedByUserId,
      };
    });
  }

  static async deleteArchivoById(id) {
    return PrediccionesDevData.deleteArchivoById(id);
  }

  static async insertArchivo({
    tipo,
    modeloSlug,
    mesObjetivo,
    uploadedByUserId,
    fileName,
    contentType,
    fileSizeBytes, // lo recibes hoy; si no está en tabla, lo puedes guardar en MetaJson
    fileContent,
    meta,
  }) {
    // 👇 tu tabla tiene HashSha256 obligatorio: aquí lo calculamos
    const hashSha256 = crypto.createHash("sha256").update(fileContent).digest("hex");

    const metaJson = JSON.stringify({
      ...meta,
      fileSizeBytes: fileSizeBytes ?? null, // por si quieres conservarlo
    });

    const row = await PrediccionesDevData.insertArchivo({
      Id: crypto.randomUUID(),
      CreatedAt: new Date(),
      Tipo: tipo,
      ModeloSlug: modeloSlug,
      MesObjetivo: mesObjetivo,
      UploadedByUserId: uploadedByUserId,
      FileName: fileName,
      ContentType: contentType || "application/octet-stream",
      FileContent: fileContent,
      HashSha256: hashSha256,
      MetaJson: metaJson,
    });

    return row.Id;
  }
}
