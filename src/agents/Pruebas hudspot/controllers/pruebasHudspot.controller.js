import crypto from 'crypto';
import { PruebasHudspotService } from '../services/pruebasHudspot.service.js';
import { logger } from '../../../shared/utils/logger.js';

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''), 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');

  if (left.length !== right.length) {
    return false;
  }

  return crypto.timingSafeEqual(left, right);
}

export class PruebasHudspotController {
  static async registrarInteres(req, res) {
    const body = req.body ?? {};
    const providedToken =
      req.headers['x-hudspot-token'] ??
      req.headers['tokenhudspot'] ??
      req.headers['x-api-key'];
    const expectedToken = process.env.TokenHudspot;

    if (!expectedToken) {
      logger.error('La variable de entorno TokenHudspot no esta configurada.');
      return res.status(500).json({
        ok: false,
        message: 'TokenHudspot no configurado en el servidor.'
      });
    }

    if (!timingSafeEqual(providedToken, expectedToken)) {
      return res.status(401).json({
        ok: false,
        message: 'TokenHudspot invalido o no proporcionado.'
      });
    }

    const interes = String(body.interes ?? body.message ?? body.descripcion ?? '').trim();
    const nombreCliente = String(body.nombreCliente ?? body.cliente?.nombre ?? '').trim();

    if (!interes) {
      return res.status(400).json({
        ok: false,
        message: 'Debes enviar el campo "interes" con lo que busca el cliente.'
      });
    }

    if (!nombreCliente) {
      return res.status(400).json({
        ok: false,
        message: 'Debes enviar el nombre del cliente en "nombreCliente".'
      });
    }

    try {
      const result = await PruebasHudspotService.procesarSolicitud({
        interes,
        cliente: {
          nombre: nombreCliente
        }
      });

      return res.status(200).json({
        ok: true,
        message: 'Interes procesado y propuesta enviada por correo.',
        ...result
      });
    } catch (error) {
      logger.error('Error procesando la solicitud de Pruebas hudspot', error);
      return res.status(500).json({
        ok: false,
        message: 'No fue posible procesar la solicitud.',
        error: error.message
      });
    }
  }
}
