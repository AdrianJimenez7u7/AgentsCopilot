// src/predicciones/data/archivos.data.js
import { prisma } from "../../../shared/prisma/client.js";

export class ArchivosData {
  static create(data) {
    return prisma.predicciones_Archivos.create({
      data,
      select: { Id: true },
    });
  }

  static findMany(where, opts = {}) {
    const { take = 200, orderBy = [{ CreatedAt: "desc" }] } = opts;
    return prisma.predicciones_Archivos.findMany({
      where,
      take,
      orderBy,
      select: {
        Id: true,
        Tipo: true,
        ModeloSlug: true,
        MesObjetivo: true,
        UploadedByUserId: true,
        FileName: true,
        ContentType: true,
        FileSizeBytes: true,
        CreatedAt: true,
        MetaJson: true,
      },
    });
  }

  static findFileById(id) {
    return prisma.predicciones_Archivos.findUnique({
      where: { Id: id },
      select: {
        Id: true,
        FileName: true,
        ContentType: true,
        FileContent: true,
      },
    });
  }

  static updateMetaById(id, metaJson) {
    return prisma.predicciones_Archivos.update({
      where: { Id: id },
      data: { MetaJson: metaJson },
      select: { Id: true },
    });
  }

  static deleteById(id) {
    return prisma.predicciones_Archivos.delete({
      where: { Id: id },
      select: { Id: true },
    });
  }

  static findLatestByTipo(modeloSlug, mesObjetivo, tipo) {
    return prisma.predicciones_Archivos.findFirst({
      where: {
        ModeloSlug: modeloSlug,
        MesObjetivo: mesObjetivo,
        Tipo: tipo,
      },
      orderBy: { CreatedAt: "desc" },
      select: {
        Id: true,
        Tipo: true,
        ModeloSlug: true,
        MesObjetivo: true,
        CreatedAt: true,
        MetaJson: true,
        FileName: true,
        ContentType: true,
        FileSizeBytes: true,
      },
    });
  }

  static findManyByModelAndMonths(where, take = 500) {
    return prisma.predicciones_Archivos.findMany({
      where,
      take,
      orderBy: [{ MesObjetivo: "desc" }, { CreatedAt: "desc" }],
      select: {
        Id: true,
        Tipo: true,
        ModeloSlug: true,
        MesObjetivo: true,
        FileName: true,
        ContentType: true,
        FileSizeBytes: true,
        MetaJson: true,
        UploadedByUserId: true,
        CreatedAt: true,
      },
    });
  }
}
