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

    static async sendCierreFormal(clienteNombre, cierres) {
        try {
            const fecha = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
            const filas = cierres.map(c => `
                <tr>
                    <td style="padding:6px 10px;border:1px solid #ddd">${c.Tecnico || '—'}</td>
                    <td style="padding:6px 10px;border:1px solid #ddd;text-align:right">${(c.ImpresionesBN || 0).toLocaleString()}</td>
                    <td style="padding:6px 10px;border:1px solid #ddd;text-align:right">${(c.ImpresionesColor || 0).toLocaleString()}</td>
                    <td style="padding:6px 10px;border:1px solid #ddd;text-align:right">${(c.TotalImpresiones || 0).toLocaleString()}</td>
                    <td style="padding:6px 10px;border:1px solid #ddd;text-align:right">$${Number(c.RentaFija || 0).toFixed(2)}</td>
                </tr>`).join('');

            await transporter.sendMail({
                from: process.env.EMAIL_USER || 'transformacion.digital@compucad.com.mx',
                to: ['miguel.jimenez@compucad.com.mx', 'katia.villafana@compucad.com.mx'],
                subject: `Cierre formal realizado — ${clienteNombre}`,
                html: `
                    <h3>Cierre formal completado</h3>
                    <p><strong>Cliente:</strong> ${clienteNombre}</p>
                    <p><strong>Fecha:</strong> ${fecha}</p>
                    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;margin-top:12px">
                        <thead>
                            <tr style="background:#B15000;color:#fff">
                                <th style="padding:8px 10px;text-align:left">Técnico</th>
                                <th style="padding:8px 10px">Imp. B/N</th>
                                <th style="padding:8px 10px">Imp. Color</th>
                                <th style="padding:8px 10px">Total</th>
                                <th style="padding:8px 10px">Renta Fija</th>
                            </tr>
                        </thead>
                        <tbody>${filas}</tbody>
                    </table>
                `
            });

            logger.info(`Notificación de cierre formal enviada para ${clienteNombre}`);
            return true;
        } catch (error) {
            logger.error('Error enviando notificación de cierre formal', error);
            return false;
        }
    }

    static async sendNotificacionFacturacion(facturacion, correoTecnico = null) {
        try {
            const fecha = facturacion.FechaCierreFacturacion
                ? new Date(facturacion.FechaCierreFacturacion).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })
                : new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

            const destinatarios = ['miguel.jimenez@compucad.com.mx', 'josue.martinez@compucad.com.mx'];
            if (correoTecnico) destinatarios.push(correoTecnico);

            await transporter.sendMail({
                from: process.env.EMAIL_USER || 'transformacion.digital@compucad.com.mx',
                to: destinatarios,
                subject: `Facturación completada — ${facturacion.ClienteNombre || 'Sin cliente'}`,
                html: `
                    <h3>Se ha registrado la facturación del siguiente cliente</h3>
                    <table cellpadding="8" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;">
                        <tr>
                            <td><strong>Cliente:</strong></td>
                            <td>${facturacion.ClienteNombre || '—'}</td>
                        </tr>
                        <tr>
                            <td><strong>Técnico responsable:</strong></td>
                            <td>${facturacion.TecnicoResponsable || '—'}</td>
                        </tr>
                        <tr>
                            <td><strong>Fecha de facturación:</strong></td>
                            <td>${fecha}</td>
                        </tr>
                    </table>
                    <p style="margin-top:16px;color:#555;font-size:12px">Este es un aviso automático del sistema de contadores.</p>
                `
            });

            logger.info(`Notificación de facturación enviada para ${facturacion.ClienteNombre} (ID: ${facturacion.id})`);
            return true;
        } catch (error) {
            logger.error('Error enviando notificación de facturación', error);
            return false;
        }
    }

    static async sendNuevoCierre(comentario) {
        try {
            const fecha = comentario.FechaCreacion
                ? new Date(comentario.FechaCreacion).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })
                : new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

            await transporter.sendMail({
                from: process.env.EMAIL_USER || 'transformacion.digital@compucad.com.mx',
                to: 'miguel.jimenez@compucad.com.mx',
                subject: `Nuevo cierre registrado — ${comentario.ClienteNombre || 'Sin cliente'}`,
                html: `
                    <h3>Se registró un nuevo comentario de cierre</h3>
                    <table cellpadding="8" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;">
                        <tr>
                            <td><strong>Cliente:</strong></td>
                            <td>${comentario.ClienteNombre || '—'}</td>
                        </tr>
                        <tr>
                            <td><strong>Técnico:</strong></td>
                            <td>${comentario.Tecnico || '—'}</td>
                        </tr>
                        <tr>
                            <td><strong>Fecha:</strong></td>
                            <td>${fecha}</td>
                        </tr>
                        <tr>
                            <td><strong>Comentario:</strong></td>
                            <td>${comentario.comentario || '—'}</td>
                        </tr>
                    </table>
                `
            });

            logger.info(`Notificación de nuevo cierre enviada (ID: ${comentario.id})`);
            return true;
        } catch (error) {
            logger.error('Error enviando notificación de nuevo cierre', error);
            return false;
        }
    }
}
