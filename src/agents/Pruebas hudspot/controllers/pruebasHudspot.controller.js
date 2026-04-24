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
  if (match) {
    return match[1].trim();
  }

  return raw;
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

function getRequestInspection(req) {
  const headerEntries = Object.entries(req.headers ?? {}).map(([key, value]) => [
    key,
    Array.isArray(value) ? value.join(', ') : String(value ?? '')
  ]);

  const maskedHeaders = Object.fromEntries(
    headerEntries.map(([key, value]) => {
      const lowerKey = key.toLowerCase();
      const shouldMask =
        lowerKey.includes('authorization') ||
        lowerKey.includes('token') ||
        lowerKey.includes('api-key') ||
        lowerKey.includes('apikey') ||
        lowerKey.includes('secret');

      return [key, shouldMask ? maskToken(value) : value];
    })
  );

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const query = req.query && typeof req.query === 'object' ? req.query : {};

  return {
    method: req.method,
    path: req.originalUrl || req.url,
    contentType: req.headers['content-type'] || null,
    headerKeys: headerEntries.map(([key]) => key),
    maskedHeaders,
    queryKeys: Object.keys(query),
    maskedQuery: Object.fromEntries(
      Object.entries(query).map(([key, value]) => {
        const lowerKey = key.toLowerCase();
        const text = Array.isArray(value) ? value.join(', ') : String(value ?? '');
        const shouldMask =
          lowerKey.includes('authorization') ||
          lowerKey.includes('token') ||
          lowerKey.includes('api-key') ||
          lowerKey.includes('apikey') ||
          lowerKey.includes('secret');

        return [key, shouldMask ? maskToken(text) : text];
      })
    ),
    bodyKeys: Object.keys(body),
    maskedBodyAuthCandidates: Object.fromEntries(
      Object.entries(body)
        .filter(([key]) => {
          const lowerKey = key.toLowerCase();
          return (
            lowerKey.includes('authorization') ||
            lowerKey.includes('token') ||
            lowerKey.includes('api-key') ||
            lowerKey.includes('apikey') ||
            lowerKey.includes('secret')
          );
        })
        .map(([key, value]) => [key, maskToken(value)])
    )
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
    const requestInspection = getRequestInspection(req);

    logger.info('Pruebas hudspot auth debug', authDebug);
    logger.info('Pruebas hudspot request inspection', requestInspection);

    if (!expectedToken) {
      logger.error('La variable de entorno TokenHudspot no esta configurada.');
      return res.status(500).json({
        ok: false,
        code: 'TOKEN_HUDSPOT_NOT_CONFIGURED',
        message: 'TokenHudspot no configurado en el servidor.',
        details: {
          auth: authDebug,
          requestInspection
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
          auth: authDebug,
          requestInspection
        }
      });
    }

    if (!timingSafeEqual(providedToken, expectedToken)) {
      return res.status(401).json({
        ok: false,
        code: 'TOKEN_HUDSPOT_INVALID',
        message: 'Se recibio una credencial para TokenHudspot, pero su valor no coincide con el configurado.',
        details: {
          auth: authDebug,
          requestInspection
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
