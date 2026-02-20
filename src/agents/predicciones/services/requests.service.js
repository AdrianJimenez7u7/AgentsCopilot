import crypto from "crypto";
import { prisma } from "../../../shared/prisma/client.js";
import { notifyInferenceReady } from "./notificaciones.service.js";

export class RequestsService {
  static async getAll() {
    const rows = await prisma.predicciones_Requests.findMany({
      orderBy: { CreatedAt: "desc" },
      select: {
        Id: true,
        UserEmail: true,
        UserName: true,
        ModelSlug: true,
        ModelName: true,
        CreatedAt: true,
        Status: true,
        CompletedAt: true,
        MonthTarget: true,
        MetaJson: true,
      },
    });

    // Mantener el shape que tu UI ya espera (igual al JSON file)
    return rows.map((r) => ({
      id: r.Id,
      userEmail: r.UserEmail,
      userName: r.UserName,
      modelSlug: r.ModelSlug,
      modelName: r.ModelName,
      createdAt: r.CreatedAt,
      status: r.Status,
      completedAt: r.CompletedAt ?? undefined,
      monthTarget: r.MonthTarget ?? undefined,
      metaJson: r.MetaJson ?? undefined,
    }));
  }

  static async handleAction(body) {
    const action = String(body?.action ?? "").trim();

    if (action === "create") {
      const userEmail = String(body.userEmail ?? "").trim();
      const userName = String(body.userName ?? "").trim();
      const modelSlug = String(body.modelSlug ?? "").trim();
      const modelName = String(body.modelName ?? "").trim();
      const monthTarget = body.monthTarget ? String(body.monthTarget).trim() : null;

      if (!userEmail || !userName || !modelSlug || !modelName) {
        const e = new Error('Campos requeridos: userEmail, userName, modelSlug, modelName.');
        e.statusCode = 400;
        throw e;
      }

      const newRow = await prisma.predicciones_Requests.create({
        data: {
          Id: crypto.randomUUID(),
          UserEmail: userEmail,
          UserName: userName,
          ModelSlug: modelSlug,
          ModelName: modelName,
          MonthTarget: monthTarget,
          Status: "pending",
          CreatedAt: new Date(),
          CompletedAt: null,
          MetaJson: body.metaJson ? JSON.stringify(body.metaJson) : null,
        },
        select: {
          Id: true,
          UserEmail: true,
          UserName: true,
          ModelSlug: true,
          ModelName: true,
          CreatedAt: true,
          Status: true,
          MonthTarget: true,
        },
      });

      return {
        ok: true,
        request: {
          id: newRow.Id,
          userEmail: newRow.UserEmail,
          userName: newRow.UserName,
          modelSlug: newRow.ModelSlug,
          modelName: newRow.ModelName,
          createdAt: newRow.CreatedAt,
          status: newRow.Status,
          monthTarget: newRow.MonthTarget ?? undefined,
        },
      };
    }

    if (action === "complete") {
      const id = String(body.id ?? "").trim();
      if (!id) {
        const e = new Error("Se requiere id para completar.");
        e.statusCode = 400;
        throw e;
      }

      let updated;
      try {
        updated = await prisma.predicciones_Requests.update({
          where: { Id: id },
          data: { Status: "completed", CompletedAt: new Date() },
          select: {
            Id: true,
            UserEmail: true,
            UserName: true,
            ModelSlug: true,
            ModelName: true,
            CreatedAt: true,
            Status: true,
            MonthTarget: true,
            CompletedAt: true,
          },
        });
      } catch {
        const e = new Error("Request not found");
        e.statusCode = 404;
        throw e;
      }

      // ✅ Construir URL a resultados (ajusta la ruta a tu frontend real)
      const appUrl = (process.env.APP_URL || "").replace(/\/+$/, "");
      const resultUrl =
        appUrl
          ? `${appUrl}/predicciones/requests/${updated.Id}` // <-- AJUSTA ESTA RUTA
          : "";

      // ✅ Disparar notificación (NO debe romper el complete si falla)
      notifyInferenceReady({
        userEmail: updated.UserEmail,
        modelName: updated.ModelName || updated.ModelSlug,
        requestId: updated.Id,
        completedAt: (updated.CompletedAt || new Date()).toISOString?.() || String(updated.CompletedAt),
        resultUrl: resultUrl || undefined,
      }).catch(() => { /* ya loggeado en helper */ });

      return {
        ok: true,
        request: {
          id: updated.Id,
          userEmail: updated.UserEmail,
          userName: updated.UserName,
          modelSlug: updated.ModelSlug,
          modelName: updated.ModelName,
          createdAt: updated.CreatedAt,
          status: updated.Status,
          monthTarget: updated.MonthTarget ?? undefined,
          completedAt: updated.CompletedAt ?? undefined,
        },
      };
    }

    const e = new Error("Invalid action");
    e.statusCode = 400;
    throw e;
  }

  static async deleteById(id) {
    try {
      await prisma.predicciones_Requests.delete({ where: { Id: id } });
    } catch {
      const e = new Error("Request not found");
      e.statusCode = 404;
      throw e;
    }
  }
}
