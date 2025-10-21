import { transporter } from '../../../shared/config/email.config.js';

export class EmailService {
  static async enviarCotizacion(email, documentoPath) {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Cotización de Productos',
      text: 'Adjunto encontrará la cotización solicitada.',
      html: '<p>Adjunto encontrará la cotización solicitada.</p>',
      attachments: [{
        filename: 'cotizacion.docx',
        path: documentoPath
      }]
    });
  }
}