import { CsfService } from '../services/csf.service.js';
import { logger } from '../../../shared/utils/logger.js';

export class CsfController {
  static async extraer(req, res) {
    const { base64_code: base64Code } = req.body ?? {};

    if (typeof base64Code !== 'string' || !base64Code.trim()) {
      return res.status(400).json({
        message: 'El campo base64_code es requerido.'
      });
    }

    try {
      const body = await CsfService.extraerDesdeBase64(base64Code);
      return res.status(200).json({ body });
    } catch (error) {
      logger.error('Error procesando CSF con Document Intelligence', error);
      return res.status(200).json({
        body: CsfService.getEmptyBody()
      });
    }
  }
}
