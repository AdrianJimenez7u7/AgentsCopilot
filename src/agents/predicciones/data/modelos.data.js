import { prisma } from "../../../shared/prisma/client.js";

export class ModelosData {
  static list() {
    return prisma.predicciones_Modelos.findMany({
      orderBy: { UpdatedAt: "desc" },
      select: {
        Id: true, Slug: true, Nombre: true, Estado: true,
        VersionActual: true, Descripcion: true, ConfigJson: true,
        CreatedAt: true, UpdatedAt: true,
      },
    });
  }

  static getBySlug(slug) {
    return prisma.predicciones_Modelos.findUnique({
      where: { Slug: slug },
      select: {
        Id: true, Slug: true, Nombre: true, Estado: true,
        VersionActual: true, Descripcion: true, ConfigJson: true,
        CreatedAt: true, UpdatedAt: true,
      },
    });
  }

  static create(data) {
    return prisma.predicciones_Modelos.create({ data });
  }

  static updateBySlug(slug, data) {
    return prisma.predicciones_Modelos.update({
      where: { Slug: slug },
      data,
      select: {
        Id: true, Slug: true, Nombre: true, Estado: true,
        VersionActual: true, Descripcion: true, ConfigJson: true,
        CreatedAt: true, UpdatedAt: true,
      },
    });
  }

  static deleteBySlug(slug) {
    return prisma.predicciones_Modelos.delete({ where: { Slug: slug } });
  }
}
