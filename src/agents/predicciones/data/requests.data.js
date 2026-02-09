import { prisma } from "../../../shared/prisma/client.js";

export class RequestsData {
  static listAll() {
    return prisma.predicciones_Requests.findMany({
      orderBy: { CreatedAt: "desc" },
      select: {
        Id: true,
        UserEmail: true,
        UserName: true,
        ModelSlug: true,
        ModelName: true,
        MonthTarget: true,
        Status: true,
        CreatedAt: true,
        CompletedAt: true,
        MetaJson: true,
      },
    });
  }

  static create(data) {
    return prisma.predicciones_Requests.create({ data });
  }

  static async markCompleted(id) {
    // update y regresa la row
    try {
      return await prisma.predicciones_Requests.update({
        where: { Id: id },
        data: { Status: "completed", CompletedAt: new Date() },
        select: {
          Id: true,
          UserEmail: true,
          UserName: true,
          ModelSlug: true,
          ModelName: true,
          MonthTarget: true,
          Status: true,
          CreatedAt: true,
          CompletedAt: true,
        },
      });
    } catch {
      return null;
    }
  }

  static deleteById(id) {
    return prisma.predicciones_Requests.delete({ where: { Id: id } });
  }
}
