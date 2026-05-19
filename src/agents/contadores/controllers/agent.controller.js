import fs from "fs";
import multer from "multer";
import { AgentAIService } from "../services/agentAI.service.js";

const upload = multer({
    dest: 'src/agents/contadores/data/', // Carpeta temporal para uploads
    limits: { fileSize: 16 * 1024 * 1024 } // 16MB límite
});

export class agentController {
    constructor(agentAIService = new AgentAIService()) {
        this.agentAIService = agentAIService;
    }


    /**
     * Middleware de subida de archivos PDF (multer).
     * @type {import('express').RequestHandler}
     */
    static uploadPdf = upload.any();
    static uploadCsv = upload.single('file');

    /**
     * 
     * @param {*} request 
     * @param {*} response 
     */
    async chat(request, response) {
        try {
            const requestFile = request.files?.[0];
            const requestUserData = {
                name: request.body?.user_name || "No proporcionado",
                email: request.body?.user_email || "No proporcionado",
            };
            const requestMessage = request.body?.message || "";
            const requestHistory = request.body?.history || [];

            const requestData = {
                message: requestMessage,
                user: requestUserData,
                history: requestHistory,
                file: requestFile ? { name: requestFile.originalname, path: requestFile.path } : null,
            };
        const resultado = await this.agentAIService.procesarMensajeCompleto(requestData);
        await this.eliminarArchivoTemporal(requestData.file?.path);
        response.status(200).json(resultado);
        } catch (error) {
            console.error('Error en el controlador del agente:', error);
            response.status(500).json({ error: 'Ocurrió un error al procesar la solicitud.' });
        }
    }

    async eliminarArchivoTemporal(path) {
        try {
            if (!path) {
                return;
            }
            await fs.promises.unlink(path);
            console.log(`Archivo temporal eliminado: ${path}`);
        } catch (error) {
            console.error(`Error al eliminar archivo temporal ${path}:`, error);
        }
    }
}