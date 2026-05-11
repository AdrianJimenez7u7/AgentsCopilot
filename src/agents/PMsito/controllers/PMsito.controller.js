import path from 'path';
import fs from 'fs';
import { generateDocxReport } from "../services/docx.service.js";
import { EmailService } from "../services/email.service.js";
import { DataverseService } from "../services/dataverse.service.js";
import { AzureAIService } from '../services/azureAI.service.js';

function extractJsonPayload(text) {
    if (!text) return null;
    const fenced = text.match(/```json([\s\S]*?)```/i);
    if (fenced && fenced[1]) return fenced[1].trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) return text.slice(start, end + 1);
    return null;
}

function parseRiskEvaluation(rawText) {
    const payload = extractJsonPayload(rawText) || rawText;
    try {
        const parsed = JSON.parse(payload);
        if (parsed && typeof parsed === 'object') return parsed;
    } catch (err) {
        // fall back to plain text
    }
    return { resumen: String(rawText || '').trim(), items: [] };
}

async function buildRiskEvaluation(plannerName, casos, tasks) {
    const aiService = new AzureAIService();
    const casosResumen = (casos || []).map(c => {
        const parts = [];
        if (c.casoNumero) parts.push(`#${c.casoNumero}`);
        if (c.casoTitulo) parts.push(c.casoTitulo);
        if (c.casoEstadoLabel || c.casoEstado) parts.push(`Estado: ${c.casoEstadoLabel || c.casoEstado}`);
        const comentariosCount = Array.isArray(c.comentarios) ? c.comentarios.length : 0;
        parts.push(`Comentarios: ${comentariosCount}`);
        return parts.join(' | ');
    }).join('\n');

    const prompt = [
        `Planner: ${plannerName}`,
        `Total tareas: ${Array.isArray(tasks) ? tasks.length : 0}`,
        `Casos CRM:`,
        casosResumen || 'Sin casos CRM relacionados.'
    ].join('\n');

    const systemPrompt = [
        'Eres un analista de riesgos de proyectos.',
        'Devuelve SOLO JSON valido con esta forma:',
        '{"resumen":"texto corto","items":[{"riesgo":"","impacto":"","probabilidad":"Alta|Media|Baja","severidad":"Alta|Media|Baja","mitigacion":""}]}'
    ].join(' ');

    const raw = await aiService.generarRespuesta(prompt, systemPrompt);
    return parseRiskEvaluation(raw);
}

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

    static async obtenerInformacionCasoCRMByPlanner(req, res) {
        try {
            const plannerNombre = req.query.planner;
            console.log('Planner recibido en query:', plannerNombre);
            const dataverseService = new DataverseService();
            const info = await dataverseService.getCasoPorPlanner(plannerNombre);
            return res.status(200).json(info);
        } catch (error) {
            console.error('Error obteniendo información de caso CRM por planner:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    static async generarReporteDesdePlanner(req, res) {
        try {
            const payload = (req.body && typeof req.body === 'object' && 'body' in req.body)
                ? req.body.body
                : req.body || {};

            const { plannerName, recipient, outputName = `reporte_${Date.now()}`, nameReport } = payload;

            if (!plannerName) return res.status(400).json({ error: 'Falta plannerName en el body' });

            const dataverseService = new DataverseService();
            const { tasks, meta } = await dataverseService.getPlannerReportData(plannerName);

            try {
                meta.riskEvaluation = await buildRiskEvaluation(plannerName, meta.casos || [], tasks || []);
            } catch (riskErr) {
                console.error('Error generando evaluacion de riesgos:', riskErr);
                meta.riskEvaluation = null;
            }

            // Pasamos el objeto { tasks, meta } al generador para que inyecte comentarios y meta
            const { outPath: docxPath } = await generateDocxReport({ tasks, meta }, outputName, null, nameReport || plannerName);

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

            if (correoEnviado && fs.existsSync(docxPath)) fs.unlinkSync(docxPath);

            return res.status(200).json({ docPath: docxPath, docName, correoEnviado, recipient });
        } catch (error) {
            console.error('Error generando reporte desde planner:', error);
            return res.status(500).json({ error: error.message });
        }
    }

    static async generarReporteDesdePlannerDescargar(req, res) {
        try {
            const payload = (req.body && typeof req.body === 'object' && 'body' in req.body)
                ? req.body.body
                : req.body || {};

            const { plannerName, outputName = `reporte_${Date.now()}`, nameReport } = payload;

            if (!plannerName) return res.status(400).json({ error: 'Falta plannerName en el body' });

            const dataverseService = new DataverseService();
            const { tasks, meta } = await dataverseService.getPlannerReportData(plannerName);

            try {
                meta.riskEvaluation = await buildRiskEvaluation(plannerName, meta.casos || [], tasks || []);
            } catch (riskErr) {
                console.error('Error generando evaluacion de riesgos:', riskErr);
                meta.riskEvaluation = null;
            }

            const { outPath: docxPath } = await generateDocxReport({ tasks, meta }, outputName, null, nameReport || plannerName);
            const docName = path.basename(docxPath);

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            res.setHeader('Content-Disposition', `attachment; filename="${docName}"`);

            const fileStream = fs.createReadStream(docxPath);
            fileStream.on('error', (err) => {
                console.error('Error enviando archivo:', err);
                if (!res.headersSent) res.status(500).json({ error: 'Error enviando archivo' });
            });

            res.on('finish', () => {
                if (fs.existsSync(docxPath)) fs.unlinkSync(docxPath);
            });

            fileStream.pipe(res);
        } catch (error) {
            console.error('Error generando reporte desde planner (descarga):', error);
            return res.status(500).json({ error: error.message });
        }
    }

    static async generarEvaluacionRiesgosIA(req, res) {
        try {
            const payload = (req.body && typeof req.body === 'object' && 'body' in req.body)
                ? req.body.body
                : req.body || {};

            const { plannerName } = payload;
            if (!plannerName) return res.status(400).json({ error: 'Falta plannerName en el body' });

            const dataverseService = new DataverseService();
            const { tasks, meta } = await dataverseService.getPlannerReportData(plannerName);

            const riskEvaluation = await buildRiskEvaluation(plannerName, meta.casos || [], tasks || []);
            return res.status(200).json(riskEvaluation);
        } catch (error) {
            console.error('Error generando evaluacion de riesgos:', error);
            return res.status(500).json({ error: error.message });
        }
    }
}