// shared/middleware/auth.middleware.js
import crypto from 'crypto';

function tsecEqual(a, b) {
  const A = Buffer.from(String(a) ?? '', 'utf8');
  const B = Buffer.from(String(b) ?? '', 'utf8');
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

export const apiKeyAuth = (req, res, next) => {
  const apiKeyHeader = req.headers['x-api-key'];
  const envSingle = process.env.API_KEY;         // una sola clave
  const envMulti  = process.env.API_KEYS || '';  // varias (separadas por coma)

  // Si no hay claves configuradas, permite todo (tu comportamiento actual)
  if (!envSingle && !envMulti) return next();

  // Construye el set de claves válidas
  const validKeys = new Set(
    (envMulti ? envMulti.split(',') : [])
      .concat(envSingle ? [envSingle] : [])
      .map(k => k.trim())
      .filter(Boolean)
  );

  // Validación
  if (!apiKeyHeader || ![...validKeys].some(k => tsecEqual(apiKeyHeader, k))) {
    return res.status(401).json({
      success: false,
      message: 'ACCESO NO AUTORIZADO: Clave API inválida o no proporcionada'
    });
  }

  return next();
};
