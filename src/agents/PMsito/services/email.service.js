import { transporter } from '../../../shared/config/email.config.js';

export class EmailService {
  static async enviarReportePlanner(email, documentoPath, docName) {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Reporte del Planner',
      text: 'Adjunto encontrará el reporte del planner solicitado.',
      html: '<p>Adjunto encontrará el reporte del planner solicitado mediante la herramienta PMsito.</p>',
      attachments: [{
        filename: docName,
        path: documentoPath
      }]
    });
  }
}