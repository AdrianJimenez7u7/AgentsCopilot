import crypto from "crypto";
import { RealesData } from "../data/reales.data.js";

export class RealesService {
  static async existe({ modeloSlug, mesObjetivo }) {
    const row = await RealesData.findLatestActuals({ modeloSlug, mesObjetivo });
    return { exists: !!row, archivoId: row?.Id ?? null };
  }

  static async upload({ modeloSlug, mesObjetivo, fileName, contentType, fileContent, uploadedByUserId }) {
    const hashSha256 = crypto.createHash("sha256").update(fileContent).digest("hex");

    const metaJson = JSON.stringify({
      fileSizeBytes: fileContent?.length ?? null,
    });

    const row = await RealesData.insertActuals({
      Id: crypto.randomUUID(),
      CreatedAt: new Date(),
      ModeloSlug: modeloSlug,
      Tipo: "actuals",
      MesObjetivo: mesObjetivo,
      FileName: fileName,
      ContentType: contentType,
      FileContent: fileContent,
      HashSha256: hashSha256,
      MetaJson: metaJson,
      UploadedByUserId: uploadedByUserId,
    });

    return row.Id;
  }
}
