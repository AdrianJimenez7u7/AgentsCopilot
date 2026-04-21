import { transporter } from '../../../shared/config/email.config.js';

export class EmailService {
  static async enviarReportePlanner(email, documentoPath, docName) {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Reporte de Avances del Proyecto',
      text: 'Adjunto encontrará el reporte de avances del proyecto solicitado.',
      html: '<p>Adjunto encontrará el reporte de avances del proyecto solicitado mediante la herramienta PMsito.</p>',
      attachments: [{
        filename: docName,
        path: documentoPath
      }]
    });
  }
}