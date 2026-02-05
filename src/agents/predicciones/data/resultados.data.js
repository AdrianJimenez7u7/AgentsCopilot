import { prisma } from "../../../shared/prisma/client.js";

export class ResultadosData {
  static getLatestInferOutputFile({ modeloSlug, mesObjetivo }) {
    return prisma.predicciones_Archivos.findFirst({
      where: { ModeloSlug: modeloSlug, MesObjetivo: mesObjetivo, Tipo: "infer-output" },
      orderBy: { CreatedAt: "desc" },
      select: { FileContent: true, FileName: true },
    });
  }
}
