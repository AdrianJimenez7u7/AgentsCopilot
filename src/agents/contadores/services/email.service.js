import { transporter } from '../../../shared/config/email.config.js';
import { logger } from '../../../shared/utils/logger.js';
import path from 'path';

export class EmailService {
    static async sendReport(email, reportPaths, cc = []) {
        try {
            const paths = Array.isArray(reportPaths) ? reportPaths : [reportPaths];
            const attachments = paths.map(p => ({
                filename: path.basename(p),
                path: p
            }));

            await transporter.sendMail({
                from: process.env.EMAIL_USER || "transformacion.digital@compucad.com.mx",
                to: email,
                cc: cc,
                subject: 'Reporte de Contadores Generado',
                text: 'Adjunto encontrará los reportes de contadores generados.',
                html: '<p>Adjunto encontrará los reportes de contadores generados.</p>',
                attachments: attachments
            });

            logger.info(`Reporte enviado exitosamente a ${email} (CC: ${cc.join(', ')})`);
            return true;
        } catch (error) {
            logger.error(`Error enviando reporte a ${email}`, error);
            return false;
        }
    }
}
