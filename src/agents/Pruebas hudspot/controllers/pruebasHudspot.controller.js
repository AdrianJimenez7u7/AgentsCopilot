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

function maskToken(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (text.length <= 8) return `${text.slice(0, 2)}***`;
  return `${text.slice(0, 4)}***${text.slice(-2)}`;
}

function getBearerToken(headerValue) {
  const raw = String(headerValue ?? '').trim();
  if (!raw) return null;

  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function getAuthDebugPayload({ tokenFromXHudspot, tokenFromTokenHudspot, tokenFromApiKey, tokenFromAuthorization }) {
  return {
    hasXHudspotToken: Boolean(tokenFromXHudspot),
    hasTokenHudspot: Boolean(tokenFromTokenHudspot),
    hasXApiKey: Boolean(tokenFromApiKey),
    hasAuthorizationBearer: Boolean(tokenFromAuthorization),
    xHudspotTokenPreview: maskToken(tokenFromXHudspot),
    tokenHudspotPreview: maskToken(tokenFromTokenHudspot),
    xApiKeyPreview: maskToken(tokenFromApiKey),
    authorizationBearerPreview: maskToken(tokenFromAuthorization)
  };
}

export class PruebasHudspotController {
  static async registrarInteres(req, res) {
    const body = req.body ?? {};
    const tokenFromXHudspot = req.headers['x-hudspot-token'];
    const tokenFromTokenHudspot = req.headers['tokenhudspot'];
    const tokenFromApiKey = req.headers['x-api-key'];
    const tokenFromAuthorization = getBearerToken(req.headers.authorization);
    const providedToken =
      tokenFromXHudspot ??
      tokenFromTokenHudspot ??
      tokenFromApiKey ??
      tokenFromAuthorization;
    const expectedToken = process.env.TokenHudspot;
    const authDebug = getAuthDebugPayload({
      tokenFromXHudspot,
      tokenFromTokenHudspot,
      tokenFromApiKey,
      tokenFromAuthorization
    });

    logger.info('Pruebas hudspot auth debug', authDebug);

    if (!expectedToken) {
      logger.error('La variable de entorno TokenHudspot no esta configurada.');
      return res.status(500).json({
        ok: false,
        code: 'TOKEN_HUDSPOT_NOT_CONFIGURED',
        message: 'TokenHudspot no configurado en el servidor.',
        details: {
          auth: authDebug
        }
      });
    }

    if (!providedToken) {
      return res.status(401).json({
        ok: false,
        code: 'TOKEN_HUDSPOT_MISSING',
        message: 'No se recibio ninguna credencial valida para TokenHudspot.',
        details: {
          expectedAuthFormats: [
            'x-api-key: <token>',
            'x-hudspot-token: <token>',
            'TokenHudspot: <token>',
            'Authorization: Bearer <token>'
          ],
          auth: authDebug
        }
      });
    }

    if (!timingSafeEqual(providedToken, expectedToken)) {
      return res.status(401).json({
        ok: false,
        code: 'TOKEN_HUDSPOT_INVALID',
        message: 'Se recibio una credencial para TokenHudspot, pero su valor no coincide con el configurado.',
        details: {
          auth: authDebug
        }
      });
    }

    const interes = String(body.interes ?? body.message ?? body.descripcion ?? '').trim();
    const nombreCliente = String(body.nombreCliente ?? body.cliente?.nombre ?? '').trim();

    if (!interes) {
      return res.status(400).json({
        ok: false,
        code: 'INTERES_REQUIRED',
        message: 'Debes enviar el campo "interes" con lo que busca el cliente.',
        details: {
          requiredFields: ['interes', 'nombreCliente']
        }
      });
    }

    if (!nombreCliente) {
      return res.status(400).json({
        ok: false,
        code: 'NOMBRE_CLIENTE_REQUIRED',
        message: 'Debes enviar el nombre del cliente en "nombreCliente".',
        details: {
          requiredFields: ['interes', 'nombreCliente']
        }
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
        code: 'PRUEBAS_HUDSPOT_PROCESSING_ERROR',
        message: 'No fue posible procesar la solicitud.',
        error: error.message,
        details: {
          marcaSugerida: interes
        }
      });
    }
  }
}
