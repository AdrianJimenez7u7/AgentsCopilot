import { prisma } from "../../../shared/prisma/client.js";

export class RealesData {
  static findLatestActuals({ modeloSlug, mesObjetivo }) {
    return prisma.predicciones_Archivos.findFirst({
      where: { ModeloSlug: modeloSlug, MesObjetivo: mesObjetivo, Tipo: "actuals" },
      orderBy: { CreatedAt: "desc" },
      select: { Id: true },
    });
  }

  static insertActuals(data) {
    return prisma.predicciones_Archivos.create({
      data,
      select: { Id: true },
    });
  }
}
