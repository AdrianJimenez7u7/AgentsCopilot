import { CsfService } from '../services/csf.service.js';
import { logger } from '../../../shared/utils/logger.js';
import crypto from 'crypto';

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

export class CsfController {
  static async extraer(req, res) {
    const { base64_code: base64Code, TokenPowerPlatform } = req.body ?? {};
    const expectedToken = process.env.TokenPowerPlatform;

    if (!expectedToken) {
      logger.error('La variable de entorno TokenPowerPlatform no está configurada.');
      return res.status(500).json({
        message: 'TokenPowerPlatform no configurado en el servidor.'
      });
    }

    if (!timingSafeEqual(TokenPowerPlatform, expectedToken)) {
      return res.status(401).json({
        message: 'TokenPowerPlatform inválido o no proporcionado.'
      });
    }

    if (typeof base64Code !== 'string' || !base64Code.trim()) {
      return res.status(400).json({
        message: 'El campo base64_code es requerido.'
      });
    }

    try {
      const body = await CsfService.extraerDesdeBase64(base64Code);
      return res.status(200).json(body);
    } catch (error) {
      logger.error('Error procesando CSF con Document Intelligence', error);
      return res.status(200).json(CsfService.getEmptyBody());
    }
  }
}
