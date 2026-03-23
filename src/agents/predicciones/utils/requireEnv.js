export function requireEnv(keys) {
  const missing = keys.filter((k) => !process.env[k] || String(process.env[k]).trim() === "");
  if (missing.length) {
    const msg = `Faltan variables de entorno: ${missing.join(", ")}`;
    const err = new Error(msg);
    err.statusCode = 500;
    throw err;
  }
}
