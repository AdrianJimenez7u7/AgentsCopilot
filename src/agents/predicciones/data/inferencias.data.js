import { prisma } from "../../../shared/prisma/client.js";

export class InferenciasData {
  static listInferenciasUsuario({ modeloSlug }) {
    const where = { Tipo: "infer-output" };
    if (modeloSlug) where.ModeloSlug = modeloSlug;

    return prisma.predicciones_Archivos.findMany({
      where,
      orderBy: [{ MesObjetivo: "desc" }, { CreatedAt: "desc" }],
      select: {
        Id: true,
        Tipo: true,
        ModeloSlug: true,
        MesObjetivo: true,
        FileName: true,
        ContentType: true,
        MetaJson: true,
        CreatedAt: true,
        UploadedByUserId: true,
      },
    });
  }

  static findLatestByModeloMesTipo({ modeloSlug, mesObjetivo, tipo, select }) {
    return prisma.predicciones_Archivos.findFirst({
      where: { ModeloSlug: modeloSlug, MesObjetivo: mesObjetivo, Tipo: tipo },
      orderBy: { CreatedAt: "desc" },
      select,
    });
  }

  static updateMetaJson(id, metaStr) {
    return prisma.predicciones_Archivos.update({
      where: { Id: id },
      data: { MetaJson: metaStr },
      select: { Id: true },
    });
  }

  static listDisponibles({ modeloSlug, tipo }) {
    // Replicamos tu SQL con JSON_VALUE para "no locked"
    return prisma.$queryRaw`
      SELECT
        MesObjetivo,
        CONVERT(NVARCHAR(36), Id) AS Id,
        FileName,
        CreatedAt
      FROM dbo.Predicciones_Archivos
      WHERE ModeloSlug = ${modeloSlug}
        AND Tipo = ${tipo}
        AND (
          MetaJson IS NULL
          OR TRY_CONVERT(bit, JSON_VALUE(MetaJson, '$.isLocked')) IS NULL
          OR TRY_CONVERT(bit, JSON_VALUE(MetaJson, '$.isLocked')) = 0
        )
      ORDER BY MesObjetivo DESC, CreatedAt DESC
    `;
  }

  // ✅ NUEVO: “mis” (solo desbloqueadas)
  static async listUnlockedInferOutputs({ userId }) {
    // Nota: “solo desbloqueadas” en tu código actual es:
    // JSON_VALUE(MetaJson,'$.isLocked') = 'false'
    // (o sea: metaJson debe existir y tener isLocked false)
    if (userId) {
      return prisma.$queryRaw`
        SELECT
          ModeloSlug,
          MesObjetivo,
          CONVERT(NVARCHAR(36), Id) as archivoId,
          FileName,
          CreatedAt,
          MetaJson,
          UploadedByUserId
        FROM dbo.Predicciones_Archivos
        WHERE
          Tipo = 'infer-output'
          AND ModeloSlug IS NOT NULL
          AND MesObjetivo IS NOT NULL
          AND JSON_VALUE(MetaJson, '$.isLocked') = 'false'
          AND UploadedByUserId = ${userId}
        ORDER BY ModeloSlug ASC, MesObjetivo DESC, CreatedAt DESC
      `;
    }

    return prisma.$queryRaw`
      SELECT
        ModeloSlug,
        MesObjetivo,
        CONVERT(NVARCHAR(36), Id) as archivoId,
        FileName,
        CreatedAt,
        MetaJson,
        UploadedByUserId
      FROM dbo.Predicciones_Archivos
      WHERE
        Tipo = 'infer-output'
        AND ModeloSlug IS NOT NULL
        AND MesObjetivo IS NOT NULL
        AND JSON_VALUE(MetaJson, '$.isLocked') = 'false'
      ORDER BY ModeloSlug ASC, MesObjetivo DESC, CreatedAt DESC
    `;
  }
}
