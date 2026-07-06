/**
 * cardImageGuard — Mitigacion del lab de "tracking pixel en Adaptive Cards".
 *
 * Problema demostrado: los campos de imagen de las cards (Image.url,
 * backgroundImage, etc.) aceptan CUALQUIER URL. Un atacante puede apuntar a un
 * beacon externo y capturar metadata del destinatario cuando su cliente
 * renderiza la card.
 *
 * Defensa: validar toda URL de imagen contra una allow-list de dominios de
 * confianza ANTES de armar/enviar la card. Cualquier URL fuera de la lista se
 * rechaza (o se reemplaza por un placeholder) y se registra el intento.
 */

// Dominios permitidos para imagenes en cards. Ajusta a tus origenes reales.
const DEFAULT_ALLOWED_HOSTS = [
    'hubinn.compucad.com.mx',
    'compucad.com.mx',
    'compucloud.com.mx',
    'graph.microsoft.com',
    'sharepoint.com',            // *.sharepoint.com
];

function hostAllowed(host, allowed) {
    const h = host.toLowerCase();
    return allowed.some(dom => h === dom || h.endsWith('.' + dom));
}

/**
 * Valida una sola URL de imagen.
 * @returns {{ ok: boolean, reason?: string }}
 */
export function isImageUrlAllowed(url, allowed = DEFAULT_ALLOWED_HOSTS) {
    if (typeof url !== 'string' || !url.trim()) return { ok: false, reason: 'empty' };

    // Permitir data URIs de imagen embebida (no salen a la red).
    if (/^data:image\//i.test(url)) return { ok: true };

    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return { ok: false, reason: 'invalid_url' };
    }

    if (parsed.protocol !== 'https:') return { ok: false, reason: 'not_https' };
    if (!hostAllowed(parsed.hostname, allowed)) return { ok: false, reason: 'host_not_allowed' };

    return { ok: true };
}

/**
 * Recorre recursivamente un objeto de Adaptive Card y sanea todo campo de
 * imagen. Las URLs no permitidas se reemplazan por `placeholder` (o se vacian)
 * y se acumulan en `violations` para logging/alertas.
 *
 * @param {object} card  Objeto de la card (se muta una copia).
 * @param {object} opts  { allowed, placeholder, drop }
 * @returns {{ card: object, violations: Array<{field:string,url:string,reason:string}> }}
 */
export function sanitizeCardImages(card, opts = {}) {
    const allowed = opts.allowed || DEFAULT_ALLOWED_HOSTS;
    const placeholder = opts.placeholder ?? '';
    const drop = opts.drop ?? true; // true: reemplaza; false: solo reporta
    const violations = [];

    // Campos de las Adaptive Cards que cargan imagenes externas.
    const IMAGE_FIELDS = new Set(['url', 'backgroundImage', 'poster', 'iconUrl']);

    const clone = JSON.parse(JSON.stringify(card));

    const walk = (node, pathStr) => {
        if (Array.isArray(node)) {
            node.forEach((item, i) => walk(item, `${pathStr}[${i}]`));
            return;
        }
        if (node && typeof node === 'object') {
            for (const [key, value] of Object.entries(node)) {
                const childPath = pathStr ? `${pathStr}.${key}` : key;

                // backgroundImage puede ser string u objeto { url: ... }
                if (IMAGE_FIELDS.has(key) && typeof value === 'string') {
                    const verdict = isImageUrlAllowed(value, allowed);
                    if (!verdict.ok) {
                        violations.push({ field: childPath, url: value, reason: verdict.reason });
                        if (drop) node[key] = placeholder;
                    }
                } else {
                    walk(value, childPath);
                }
            }
        }
    };

    walk(clone, '');
    return { card: clone, violations };
}

export const CARD_IMAGE_ALLOWED_HOSTS = DEFAULT_ALLOWED_HOSTS;
