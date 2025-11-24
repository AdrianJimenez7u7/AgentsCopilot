import path from 'path';
import { generateDocxReport } from "../services/docx.service.js";
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
                templateName,
                recipient,
                chartType = 'bar',
                outputName = `reporte_${Date.now()}`,
                nameReport
            } = payload;

            console.log(payload);
            console.log(JSON.stringify(payload, null, 2));

            if (!data || !templateName ) {
                return res.status(400).json({ error: 'Faltan parámetros obligatorios: data, templateName' });
            }

            // validar chartType y normalizar
            const ct = ['bar', 'pie', 'doughnut'].includes(String(chartType).toLowerCase())
                ? String(chartType).toLowerCase()
                : 'bar';

            // pasar outputName como 3er arg y chartType como 4to, nameReport como 5to
            const {outPath: docPath, outChartPath: chartPath} = await generateDocxReport(data, templateName, outputName, ct, nameReport);

            const docName = path.basename(docPath);
            let correoEnviado = false;

            try {
                await EmailService.enviarReportePlanner(recipient, docPath, docName);
                correoEnviado = true;
                if (correoEnviado) {
                    console.log(`Correo enviado exitosamente a ${recipient}`);
                    const fs = await import('fs');
                    if (fs.existsSync(docPath)) {
                        fs.unlinkSync(docPath);
                    }
                    if (fs.existsSync(chartPath)) {
                        fs.unlinkSync(chartPath);
                        console.log(`Archivo temporal ${docName} eliminado.`);
                    }
                }
            } catch (emailErr) {
                console.error('Error enviando correo:', emailErr);
                correoEnviado = false;
            }

            return res.status(200).json({ docPath, docName, correoEnviado, recipient });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }
}