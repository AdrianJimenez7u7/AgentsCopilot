import path from 'path';
import fs from 'fs';
import { generateDocxReport } from "../services/docx.service.js";
import { EmailService } from "../services/email.service.js";
import { DataverseService } from "../services/dataverse.service.js";

export class PMsitoController {

    static async generarReporte(req, res) {
        try {
            // Normalizar payload: algunos proxies/tunnels o integraciones meten el body dentro de req.body.body
            const payload = (req.body && typeof req.body === 'object' && 'body' in req.body)
                ? req.body.body
                : req.body || {};

            const {
                data,
                templateName, // se conserva por retrocompatibilidad pero ya no se usa
                recipient,
                chartType = 'bar',
                outputName = `reporte_${Date.now()}`,
                nameReport
            } = payload;

            if (!data) {
                return res.status(400).json({ error: 'Faltan parámetros obligatorios: data' });
            }

            // Generar DOCX con la plantilla CCD-PMO-F03.docx
            const { outPath: docxPath } = await generateDocxReport(data, outputName, null, nameReport);

            const docName = path.basename(docxPath);
            let correoEnviado = false;

            if (recipient) {
                try {
                    await EmailService.enviarReportePlanner(recipient, docxPath, docName);
                    correoEnviado = true;
                } catch (emailErr) {
                    console.error('Error enviando correo:', emailErr);
                    correoEnviado = false;
                }
            }

            // Limpiar archivo temporal después de enviar
            if (correoEnviado && fs.existsSync(docxPath)) {
                fs.unlinkSync(docxPath);
            }

            return res.status(200).json({ docPath: docxPath, docName, correoEnviado, recipient });
        } catch (error) {
            console.error('Error generando reporte:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    static async obtenerCasosCRM(req, res) {
        try {
            const dataverseService = new DataverseService();
            const casos = await dataverseService.getCasosCRM();
            return res.status(200).json(casos);
        } catch (error) {
            console.error('Error obteniendo casos CRM:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    static async obtenerComentariosCRM(req, res) {
        try {
            const { incidentId } = req.params;
            const dataverseService = new DataverseService();
            const comentarios = await dataverseService.getComentariosCaso(incidentId);
            return res.status(200).json(comentarios);
        } catch (error) {
            console.error('Error obteniendo comentarios CRM:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    static async obtenerTareasCasosCRM(req, res) {
        try {
            const { incidentId } = req.params;
            const dataverseService = new DataverseService();
            const tareas = await dataverseService.getTareasCaso(incidentId);
            return res.status(200).json(tareas);
        } catch (error) {
            console.error('Error obteniendo tareas de caso CRM:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    static async obtenerPlanners(req, res) {
        try {
            const dataverseService = new DataverseService();
            const planners = await dataverseService.getPlanners();
            return res.status(200).json(planners);
        } catch (error) {
            console.error('Error obteniendo planners:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    static async obtenerCarteras(req, res) {
        try {
            const dataverseService = new DataverseService();
            const carteras = await dataverseService.getListaDeCarteras();
            return res.status(200).json(carteras);
        } catch (error) {
            console.error('Error obteniendo carteras:', error);
            return res.status(500).json({ error: error.message });
        }
    }
}