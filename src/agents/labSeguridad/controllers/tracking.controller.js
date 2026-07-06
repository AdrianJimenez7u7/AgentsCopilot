/**
 * ============================================================================
 *  LAB DE CIBERSEGURIDAD — Tracking Pixel / Web Beacon (uso educativo interno)
 * ============================================================================
 *  Objetivo del laboratorio: demostrar que los campos de imagen de las
 *  Adaptive Cards (Image.url, backgroundImage, etc.) aceptan cualquier URL sin
 *  validacion. Cuando el cliente del destinatario renderiza la card, hace un
 *  GET a esa URL y podemos capturar metadata del receptor (beacon / web bug).
 *
 *  Uso EXCLUSIVO en infraestructura propia y con autorizacion. No usar contra
 *  terceros. Sirve para justificar el hardening: validar/allow-list de dominios
 *  de imagen antes de construir las cards de notificacion.
 * ============================================================================
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Carpeta de persistencia de capturas (fuera de src, en la raiz del repo)
const CAPTURES_DIR = path.resolve(__dirname, '../../../../lab-captures');
const CAPTURES_FILE = path.join(CAPTURES_DIR, 'hits.jsonl');

// PNG transparente de 1x1 (67 bytes). Sirve para que la card renderice "algo".
const PIXEL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
);

// Buffer en memoria para el dashboard en vivo (ultimos 500 hits)
const memoryHits = [];
const MAX_MEMORY = 500;

function ensureDir() {
    try {
        if (!fs.existsSync(CAPTURES_DIR)) fs.mkdirSync(CAPTURES_DIR, { recursive: true });
    } catch (e) {
        console.error('[LAB] No se pudo crear carpeta de capturas:', e.message);
    }
}

function persistHit(hit) {
    ensureDir();
    try {
        fs.appendFileSync(CAPTURES_FILE, JSON.stringify(hit) + '\n', 'utf8');
    } catch (e) {
        console.error('[LAB] No se pudo persistir hit:', e.message);
    }
    memoryHits.unshift(hit);
    if (memoryHits.length > MAX_MEMORY) memoryHits.length = MAX_MEMORY;
}

export class TrackingController {

    /**
     * GET /lab/px/:tag?  y  /lab/px
     * Devuelve un pixel transparente y registra al que lo pidio.
     */
    static pixel(req, res) {
        const ts = new Date().toISOString();

        const hit = {
            ts,
            // trust proxy=1 -> req.ip refleja el X-Forwarded-For del devtunnel
            ip: req.ip,
            ips: req.ips,                                   // cadena de proxies
            xff: req.headers['x-forwarded-for'] || null,
            realIp: req.headers['x-real-ip'] || null,
            tag: req.params.tag || null,                    // /lab/px/:tag
            query: req.query,                               // ?u=<destinatario>&c=<campania>
            userAgent: req.headers['user-agent'] || null,
            acceptLanguage: req.headers['accept-language'] || null,
            referer: req.headers['referer'] || req.headers['referrer'] || null,
            method: req.method,
            path: req.originalUrl,
            // Headers completos: utiles para identificar el proxy de Teams/Copilot
            headers: req.headers,
        };

        persistHit(hit);
        console.log(`[LAB][HIT] ${ts} | u=${hit.query?.u || '-'} | c=${hit.query?.c || '-'} | ip=${hit.ip} | ua=${hit.userAgent}`);

        // Modo "sigiloso": si viene ?to=<url https>, tras registrar redirigimos a la
        // imagen real para que la card/correo se vea normal y no levante sospechas.
        const to = req.query.to;
        if (typeof to === 'string' && /^https:\/\//i.test(to)) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
            return res.redirect(302, to);
        }

        // Sin cache: queremos registrar CADA render, no que el cliente lo cachee.
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Content-Length', PIXEL_PNG.length);
        return res.status(200).send(PIXEL_PNG);
    }

    /**
     * GET /lab/logs?token=...
     * Devuelve las capturas. Protegido con un token simple para no exponer los
     * datos capturados publicamente (aunque el pixel siga siendo publico).
     */
    static logs(req, res) {
        if (!TrackingController._authorized(req)) {
            return res.status(401).json({ ok: false, error: 'unauthorized' });
        }

        // Preferimos memoria; si esta vacia (reinicio), leemos del archivo.
        let hits = memoryHits;
        if (hits.length === 0 && fs.existsSync(CAPTURES_FILE)) {
            try {
                hits = fs.readFileSync(CAPTURES_FILE, 'utf8')
                    .split('\n')
                    .filter(Boolean)
                    .map(l => JSON.parse(l))
                    .reverse();
            } catch { /* ignore */ }
        }

        return res.json({ ok: true, total: hits.length, hits });
    }

    /**
     * GET /lab/dashboard?token=...
     * Vista HTML sencilla de los hits en vivo.
     */
    static dashboard(req, res) {
        if (!TrackingController._authorized(req)) {
            return res.status(401).send('<h1>401 - unauthorized</h1><p>Falta ?token=</p>');
        }

        const token = TrackingController._token(req);
        const rows = memoryHits.map(h => `
            <tr>
              <td>${h.ts}</td>
              <td>${escapeHtml(h.query?.u ?? '-')}</td>
              <td>${escapeHtml(h.query?.c ?? '-')}</td>
              <td>${escapeHtml(h.ip ?? '-')}</td>
              <td>${escapeHtml(h.acceptLanguage ?? '-')}</td>
              <td class="ua">${escapeHtml(h.userAgent ?? '-')}</td>
            </tr>`).join('');

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(`<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="10">
<title>LAB - Capturas beacon</title>
<style>
  body{font-family:system-ui,Segoe UI,sans-serif;margin:24px;background:#0f172a;color:#e2e8f0}
  h1{font-size:18px}
  .meta{color:#94a3b8;font-size:13px;margin-bottom:16px}
  table{border-collapse:collapse;width:100%;font-size:13px}
  th,td{border:1px solid #334155;padding:6px 8px;text-align:left;vertical-align:top}
  th{background:#1e293b;position:sticky;top:0}
  tr:nth-child(even){background:#1e293b55}
  .ua{max-width:420px;word-break:break-all;color:#93c5fd}
  code{background:#1e293b;padding:2px 6px;border-radius:4px}
</style></head>
<body>
  <h1>🎯 LAB Ciberseguridad — capturas de beacon (${memoryHits.length})</h1>
  <div class="meta">
    Auto-refresh 10s. Pixel: <code>/lab/px/logo.png?u=&lt;destinatario&gt;&amp;c=&lt;campania&gt;</code> ·
    JSON: <code>/lab/logs?token=${escapeHtml(token)}</code>
  </div>
  <table>
    <thead><tr><th>Timestamp</th><th>u (destinatario)</th><th>c (campaña)</th><th>IP</th><th>Idioma</th><th>User-Agent</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6">Sin capturas todavía…</td></tr>'}</tbody>
  </table>
</body></html>`);
    }

    // --- helpers ---
    static _token(req) {
        return req.query.token || req.headers['x-lab-token'] || '';
    }

    static _authorized(req) {
        const expected = process.env.LAB_TOKEN || 'lab-demo-2026';
        return TrackingController._token(req) === expected;
    }
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
