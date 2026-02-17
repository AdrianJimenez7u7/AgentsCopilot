import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";

const tenantId = process.env.AZURE_TENANT_ID;

// Usamos JWKS v2 (sirve aunque el issuer sea STS)
const jwksUri = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;

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
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return cb(err);
    cb(null, key.getPublicKey());
  });
}

export function entraJwtAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: "missing_bearer" });

  // 1) Verifica firma y audiencia
  jwt.verify(token, getKey, { audience: audienceList }, (err, decoded) => {
    if (err) {
      return res.status(401).json({
        ok: false,
        error: "invalid_token",
        details: err.message,
        expectedAudiences: audienceList,
      });
    }

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