import path from 'path';
import fs from 'fs';
import { generatePdfReport } from "../services/pdf.service.js";
import { EmailService } from "../services/email.service.js";

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

            // validar chartType y normalizar
            const ct = ['bar', 'pie', 'doughnut'].includes(String(chartType).toLowerCase())
                ? String(chartType).toLowerCase()
                : 'bar';

            // Generar PDF (reemplaza la generación DOCX anterior)
            const { outPath: pdfPath } = await generatePdfReport(data, outputName, ct, nameReport);

            const docName = path.basename(pdfPath);
            let correoEnviado = false;

            if (recipient) {
                try {
                    await EmailService.enviarReportePlanner(recipient, pdfPath, docName);
                    correoEnviado = true;
                    console.log(`Correo enviado exitosamente a ${recipient}`);
                } catch (emailErr) {
                    console.error('Error enviando correo:', emailErr);
                    correoEnviado = false;
                }
            }

            // Limpiar archivo temporal después de enviar
            if (correoEnviado && fs.existsSync(pdfPath)) {
                fs.unlinkSync(pdfPath);
                console.log(`Archivo temporal ${docName} eliminado.`);
            }

            return res.status(200).json({ docPath: pdfPath, docName, correoEnviado, recipient });
        } catch (error) {
            console.error('Error generando reporte:', error);
            return res.status(500).json({ error: error.message });
        }
    }
}