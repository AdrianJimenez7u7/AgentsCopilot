import multer from "multer";
import { UserMessage } from "../models/chat.js";
import { AgentAIService } from "../services/agentAI.service.js";
import { prisma } from "../../../shared/prisma/client.js";

// Multer para adjuntar un archivo opcional al agente (mismo destino que el cruce de guías).
const upload = multer({
    dest: 'src/agents/operaciones/data/',
    limits: { fileSize: 5 * 1024 * 1024 }
});

export class agentController {

    // Middleware para recibir un archivo opcional en /agent/sendMessage (campo "file").
    static uploadFile = upload.single('file');

    async procesarMensaje(req, res) {
        try {
            let { history, message, user, threadId } = req.body;

            // Con multipart/form-data (cuando se adjunta archivo) los campos llegan como string.
            if (typeof history === 'string') { try { history = JSON.parse(history); } catch { history = []; } }
            if (typeof user === 'string') { try { user = JSON.parse(user); } catch { user = undefined; } }

            if (!message || !user?.email) {
                return res.status(400).json({ error: "message y user.email son requeridos" });
            }
            const platform = "operaciones";
            let thread = null;
            if (threadId) {
                thread = await prisma.thread.findUnique({ where: { id: Number(threadId) } });
            }
            if (!thread) {
                const title = String(message).slice(0, 120);
                thread = await prisma.thread.create({
                    data: {
                        titulo: title,
                        usuario: user.email,
                        plataforma: platform,
                    },
                });
            }

            // Archivo adjunto (opcional). El cruce lo consume por su .path.
            const file = req.file
                ? {
                    originalname: req.file.originalname,
                    mimetype: req.file.mimetype,
                    size: req.file.size,
                    path: req.file.path
                }
                : null;

            const userMessage = new UserMessage(history, message, thread.id, user, file);
            await prisma.message.create({
                data: {
                    threadId: thread.id,
                    usuario: user.email,
                    role: "user",
                    contenido: message,
                },
            });

            const agentAIService = new AgentAIService();
            const resultado = await agentAIService.balanceadorDeDecisiones(userMessage);
            await prisma.message.create({
                data: {
                    threadId: thread.id,
                    usuario: user.email,
                    role: "assistant",
                    contenido: JSON.stringify(resultado),
                },
            });
            return res.status(200).json({ message: "Mensaje procesado correctamente", threadId: thread.id, data: resultado });
        }
        catch (error) {
            console.error(`[agentController] Error al procesar mensaje:`, error?.message ?? error);
            return res.status(500).json({ error: `Error al procesar mensaje: ${error?.message ?? String(error)}` });
        }
    }

    async listThreads(req, res) {
        try {
            const { userEmail } = req.query;
            if (!userEmail) {
                return res.status(400).json({ error: "userEmail es requerido" });
            }
            const threads = await prisma.thread.findMany({
                where: {
                    usuario: String(userEmail),
                    deleted: false,
                    plataforma: "operaciones",
                },
                orderBy: { updatedAt: "desc" },
                include: {
                    messages: {
                        where: {
                            deleted: false,
                            usuario: String(userEmail),
                        },
                        orderBy: { createdAt: "asc" },
                    },
                },
            });
            return res.status(200).json({ data: threads });
        }
        catch (error) {
            console.error(`[agentController] Error al listar hilos:`, error?.message ?? error);
            return res.status(500).json({ error: `Error al listar hilos: ${error?.message ?? String(error)}` });
        }
    }

    async getThreadMessages(req, res) {
        try {
            const { threadId } = req.params;
            const { userEmail } = req.query;
            const parsedId = Number(threadId);
            if (!parsedId || Number.isNaN(parsedId)) {
                return res.status(400).json({ error: "threadId invalido" });
            }
            if (!userEmail) {
                return res.status(400).json({ error: "userEmail es requerido" });
            }

            const thread = await prisma.thread.findFirst({
                where: {
                    id: parsedId,
                    usuario: String(userEmail),
                    deleted: false,
                },
            });
            if (!thread) {
                return res.status(404).json({ error: "Thread no encontrado" });
            }

            const messages = await prisma.message.findMany({
                where: {
                    threadId: parsedId,
                    deleted: false,
                },
                orderBy: { createdAt: "asc" },
            });

            return res.status(200).json({ thread, messages });
        }
        catch (error) {
            console.error(`[agentController] Error al obtener mensajes:`, error?.message ?? error);
            return res.status(500).json({ error: `Error al obtener mensajes: ${error?.message ?? String(error)}` });
        }
    }
}