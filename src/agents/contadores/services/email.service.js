import { transporter } from '../../../shared/config/email.config.js';
import { logger } from '../../../shared/utils/logger.js';
import path from 'path';

export class EmailService {
    static async sendReport(email, reportPath) {
        try {
            const filename = path.basename(reportPath);

            await transporter.sendMail({
                from: process.env.EMAIL_USER || "transformacion.digital@compucad.com.mx",
                to: email,
                subject: 'Reporte de Contadores Generado',
                text: 'Adjunto encontrará el reporte de contadores generado.',
                html: '<p>Adjunto encontrará el reporte de contadores generado.</p>',
                attachments: [{
                    filename: filename,
                    path: reportPath
                }]
            });

            logger.info(`Reporte enviado exitosamente a ${email}`);
            return true;
        } catch (error) {
            logger.error(`Error enviando reporte a ${email}`, error);
            return false;
        }
    }
}
