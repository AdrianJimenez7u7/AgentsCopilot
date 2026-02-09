// data/predicciones.dev.data.js
import { prisma } from "../../../shared/prisma/client.js";

export class PrediccionesDevData {
  static async getDiagDb() {
    const rows = await prisma.$queryRaw`
      SELECT DB_NAME() as dbName, @@SERVERNAME as serverName
    `;
    return rows?.[0] ?? { dbName: null, serverName: null };
  }

  static listArchivos({ modeloSlug, mesObjetivo, tipo, top = 200 }) {
    const where = {};
    if (modeloSlug) where.ModeloSlug = modeloSlug;
    if (mesObjetivo) where.MesObjetivo = mesObjetivo;
    if (tipo) where.Tipo = tipo;

    return prisma.predicciones_Archivos.findMany({
      where,
      orderBy: { CreatedAt: "desc" },
      take: Math.min(Math.max(1, Number(top) || 200), 1000),
      select: {
        Id: true,
        Tipo: true,
        ModeloSlug: true,
        MesObjetivo: true,
        UploadedByUserId: true,
        MetaJson: true,
        CreatedAt: true,
      },
    });
  }

  static deleteArchivoById(id) {
    return prisma.predicciones_Archivos.delete({ where: { Id: id } });
  }

  static insertArchivo(data) {
    return prisma.predicciones_Archivos.create({ data });
  }
}
