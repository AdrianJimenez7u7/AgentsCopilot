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

function findMissingField(fields) {
  return Object.entries(fields).find(([, value]) => !value);
}

function correoFueEnviado(email) {
  return Boolean(email?.accepted?.length) && !email?.rejected?.length;
}

export class PruebasHudspotController {
  static authenticate(req, res) {
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
      res.status(500).json({
        ok: false,
        code: 'TOKEN_HUDSPOT_NOT_CONFIGURED',
        message: 'TokenHudspot no configurado en el servidor.',
        details: { auth: authDebug, requestInspection }
      });
      return false;
    }

    if (!providedToken) {
      res.status(401).json({
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
      return false;
    }

    if (!timingSafeEqual(providedToken, expectedToken)) {
      res.status(401).json({
        ok: false,
        code: 'TOKEN_HUDSPOT_INVALID',
        message: 'Se recibio una credencial para TokenHudspot, pero su valor no coincide con el configurado.',
        details: { auth: authDebug, requestInspection }
      });
      return false;
    }

    return true;
  }

  static async registrarInteres(req, res) {
    if (!PruebasHudspotController.authenticate(req, res)) return;

    const body = req.body ?? {};
    const nombre = String(body.nombre ?? '').trim();
    const empresa = String(body.empresa ?? '').trim();
    const correo = String(body.correo ?? '').trim();
    const telefono = String(body.telefono ?? '').trim();
    const puesto = String(body.puesto ?? '').trim();
    const direccion = String(body.direccion ?? '').trim();
    const tamanoEmpresa = String(body.tamanoEmpresa ?? '').trim();
    const interes = String(body.interes ?? '').trim();

    const requiredFields = { nombre, empresa, correo, telefono, puesto, direccion, tamanoEmpresa, interes };
    const missingField = findMissingField(requiredFields);

    if (missingField) {
      return res.status(400).json({
        ok: false,
        code: 'CAMPO_REQUERIDO_FALTANTE',
        message: `Debes enviar el campo "${missingField[0]}".`,
        details: { requiredFields: Object.keys(requiredFields) }
      });
    }

    try {
      const result = await PruebasHudspotService.procesarSolicitud({
        interes,
        cliente: { nombre, empresa, correo, telefono, puesto, direccion, tamanoEmpresa }
      });

      return res.status(200).json({
        ok: true,
        datosCapturados: { ...result.cliente, interes },
        correoEnviado: correoFueEnviado(result.email)
      });
    } catch (error) {
      logger.error('Error procesando la solicitud de Pruebas hudspot', error);
      return res.status(500).json({
        ok: false,
        code: 'PRUEBAS_HUDSPOT_PROCESSING_ERROR',
        message: 'No fue posible procesar la solicitud.',
        error: error.message
      });
    }
  }

  static async registrarTicketAtencionCliente(req, res) {
    if (!PruebasHudspotController.authenticate(req, res)) return;

    const body = req.body ?? {};
    const nombre = String(body.nombre ?? '').trim();
    const empresa = String(body.empresa ?? '').trim();
    const correo = String(body.correo ?? '').trim();
    const telefono = String(body.telefono ?? '').trim();
    const descripcionTicket = String(body.descripcionTicket ?? '').trim();

    const requiredFields = { nombre, empresa, correo, telefono, descripcionTicket };
    const missingField = findMissingField(requiredFields);

    if (missingField) {
      return res.status(400).json({
        ok: false,
        code: 'CAMPO_REQUERIDO_FALTANTE',
        message: `Debes enviar el campo "${missingField[0]}".`,
        details: { requiredFields: Object.keys(requiredFields) }
      });
    }

    try {
      const result = await PruebasHudspotService.procesarTicketAtencionCliente({
        cliente: { nombre, empresa, correo, telefono },
        descripcionTicket
      });

      return res.status(200).json({
        ok: true,
        datosCapturados: { ...result.cliente, descripcionTicket },
        correoEnviado: correoFueEnviado(result.email)
      });
    } catch (error) {
      logger.error('Error procesando el ticket de atencion a cliente', error);
      return res.status(500).json({
        ok: false,
        code: 'ATENCION_CLIENTE_PROCESSING_ERROR',
        message: 'No fue posible procesar el ticket.',
        error: error.message
      });
    }
  }
}
