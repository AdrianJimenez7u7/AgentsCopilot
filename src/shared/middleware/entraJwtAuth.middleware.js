import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";

const tenantId = process.env.AZURE_TENANT_ID;

// Validar que el tenant ID sea válido
if (!tenantId || tenantId.trim().length === 0) {
  console.error('❌ ERROR: AZURE_TENANT_ID no configurado o vacío');
  process.exit(1);
}

console.log('✅ entraJwtAuth inicializado:', {
  tenantId: tenantId.trim(),
  jwksUri: `https://login.microsoftonline.com/${tenantId.trim()}/discovery/v2.0/keys`,
});

// Usamos JWKS v2 (sirve aunque el issuer sea STS)
const jwksUri = `https://login.microsoftonline.com/${tenantId.trim()}/discovery/v2.0/keys`;

const audienceList = [
  process.env.AZURE_API_AUDIENCE,       // api://<backendClientId>
  process.env.AZURE_BACKEND_CLIENT_ID,  // <backendClientId> GUID (por si llega así)
].filter(Boolean);

// ✅ incluye el issuer real que estás recibiendo (STS)
const allowedIssuers = [
  `https://sts.windows.net/${tenantId}/`,
  `https://login.microsoftonline.com/${tenantId}/v2.0`,
  `https://login.microsoftonline.com/${tenantId}/`,
];

const client = jwksClient({ jwksUri });

function getKey(header, cb) {
  console.log("🔐 Buscando clave pública para kid:", header.kid);
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      console.error("❌ Error obteniendo signing key:", err.message);
      return cb(err);
    }
    console.log("✅ Clave pública obtenida");
    cb(null, key.getPublicKey());
  });
}

export function entraJwtAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: "missing_bearer" });

  // Decodificar sin validar para debugging
  const decoded = jwt.decode(token);
  console.log("🔍 Token recibido:", {
    audience: decoded?.aud,
    iss: decoded?.iss,
    expectedAudiences: audienceList,
  });

  // 1) Verifica firma y audiencia
  jwt.verify(token, getKey, { audience: audienceList }, (err, decoded) => {
    if (err) {
      console.error("❌ JWT Verification Error:", {
        errorName: err.name,
        errorMessage: err.message,
        errorCode: err.code,
        jwksUri: jwksUri,
        expectedAudiences: audienceList,
        receivedAudience: jwt.decode(token)?.aud,
        tokenHeader: jwt.decode(token, { complete: true })?.header,
      });
      return res.status(401).json({
        ok: false,
        error: "invalid_token",
        details: err.message,
        expectedAudiences: audienceList,
        receivedAudience: jwt.decode(token)?.aud,
      });
    }
    console.log("✅ JWT Verificado correctamente");

    // 2) Valida issuer manualmente (porque tu token trae STS)
    if (!allowedIssuers.includes(decoded?.iss)) {
      return res.status(401).json({
        ok: false,
        error: "invalid_token",
        details: `issuer_not_allowed: ${decoded?.iss}`,
        expectedIssuers: allowedIssuers,
      });
    }

    // (Opcional) valida que venga el scope access_as_user
    const scp = decoded?.scp || "";
    if (!scp.split(" ").includes("access_as_user")) {
      return res.status(403).json({
        ok: false,
        error: "insufficient_scope",
        details: `scp_missing_access_as_user: ${scp}`,
      });
    }

    req.user = decoded;
    req.userAccessToken = token;
    next();
  });
}