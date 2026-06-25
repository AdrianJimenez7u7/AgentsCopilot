import cron from 'node-cron';
import { transporter } from '../config/email.config.js';
import { prisma } from '../prisma/client.js';
import { logger } from '../utils/logger.js';

const DESTINATARIO = 'miguel.jimenez@compucad.com.mx';

// ─── Paleta Compucad ─────────────────────────────────────────────────────────
const C = {
    azul:      '#003567',
    profundo:  '#0C1C33',
    turquesa:  '#34A798',
    verde:     '#4E901F',
    rojo:      '#EE2737',
    naranja:   '#FF9E1B',
    amarillo:  '#F1B434',
    morado:    '#5248D4',
    blanco:    '#FBFBFF',
    gris:      '#47484D',
    fondo:     '#F5F7FA',
    bordeSutil:'rgba(0,53,103,0.06)',
    cabeceraTabla:'rgba(0,53,103,0.035)',
    zebra:     'rgba(0,53,103,0.012)',
};

// ─── Helpers de formato ───────────────────────────────────────────────────────
const formatDate = (d) => d
    ? new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

const formatMoney = (n) => n != null
    ? `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`
    : '—';

// ─── Sección de tabla genérica ────────────────────────────────────────────────
function buildTable(headers, rows) {
    const thCells = headers.map(h =>
        `<th style="padding:8px 12px;text-align:left;font-size:10px;font-weight:700;color:${C.gris};
            text-transform:uppercase;letter-spacing:0.06em;white-space:nowrap;
            background:${C.cabeceraTabla};border-bottom:1px solid ${C.bordeSutil};">${h}</th>`
    ).join('');

    const trRows = rows.map((cells, i) => {
        const bg = i % 2 === 1 ? C.zebra : 'transparent';
        const tdCells = cells.map(cell =>
            `<td style="padding:8px 12px;font-size:12px;color:${C.gris};
                border-bottom:1px solid ${C.bordeSutil};background:${bg};">${cell}</td>`
        ).join('');
        return `<tr>${tdCells}</tr>`;
    }).join('');

    return `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;
        border-radius:10px;overflow:hidden;border:1px solid ${C.bordeSutil};">
        <thead><tr>${thCells}</tr></thead>
        <tbody>${trRows}</tbody>
    </table>`;
}

// ─── Badge de estado ──────────────────────────────────────────────────────────
function badge(label, color, bg) {
    return `<span style="display:inline-block;padding:2px 8px;border-radius:99px;
        font-size:10px;font-weight:700;color:${color};background:${bg}20;
        border:1px solid ${color}40;">${label}</span>`;
}

// ─── Construcción del HTML del correo ─────────────────────────────────────────
function buildEmailHtml(cotizaciones, envios) {
    const fecha = new Date().toLocaleDateString('es-MX', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
    });

    // ── Tabla de cotizaciones ────────────────────────────────────────────────
    const filasCotz = cotizaciones.length
        ? cotizaciones.map(c => [
            `<span style="font-family:'Courier New',monospace;font-weight:700;color:${C.profundo};font-size:11px;">#${c.id}</span>`,
            `<span style="color:${C.profundo};font-weight:600;">${c.usuario ?? '—'}</span>`,
            `${c.ciudadOrigen ?? '—'} → ${c.ciudadDestino ?? '—'}`,
            formatMoney(c.costoEstimado),
            c.paqueteria?.nombre ?? '—',
            formatDate(c.fecha),
            badge('Pendiente', C.amarillo, C.amarillo),
          ])
        : [[`<td colspan="7" style="padding:16px;text-align:center;color:${C.gris};font-size:13px;">Sin cotizaciones pendientes</td>`]];

    const tablaCotz = cotizaciones.length
        ? buildTable(['ID', 'Solicitante', 'Ruta', 'Costo estimado', 'Paquetería', 'Fecha', 'Estado'], filasCotz)
        : `<table width="100%"><tbody><tr><td style="padding:16px;text-align:center;color:${C.gris};font-size:13px;">Sin cotizaciones pendientes</td></tr></tbody></table>`;

    // ── Tabla de envíos ──────────────────────────────────────────────────────
    const filasEnv = envios.length
        ? envios.map(e => [
            `<span style="font-family:'Courier New',monospace;font-weight:700;color:${C.profundo};font-size:11px;">#${e.id}</span>`,
            `<span style="color:${C.profundo};font-weight:600;">${e.usuario ?? '—'}</span>`,
            `${e.ciudadOrigen ?? '—'} → ${e.ciudadDestino ?? '—'}`,
            formatMoney(e.costoEnvio),
            e.paqueteria?.nombre ?? '—',
            formatDate(e.fechaEnvio),
            badge('Creado', C.azul, C.azul),
          ])
        : null;

    const tablaEnv = filasEnv
        ? buildTable(['ID', 'Solicitante', 'Ruta', 'Costo', 'Paquetería', 'Fecha', 'Estado'], filasEnv)
        : `<table width="100%"><tbody><tr><td style="padding:16px;text-align:center;color:${C.gris};font-size:13px;">Sin envíos en estado Creado</td></tr></tbody></table>`;

    // ── KPIs de resumen ──────────────────────────────────────────────────────
    const kpis = [
        { label: 'Cotizaciones pendientes', value: cotizaciones.length, color: C.amarillo },
        { label: 'Envíos creados',          value: envios.length,       color: C.azul     },
    ].map(k => `
        <td width="50%" style="padding:0 8px;">
            <div style="background:${C.blanco};border-radius:12px;padding:16px 20px;
                border:1px solid ${C.bordeSutil};text-align:center;">
                <div style="font-size:32px;font-weight:700;color:${k.color};line-height:1;">${k.value}</div>
                <div style="font-size:10px;font-weight:600;color:${C.gris};
                    text-transform:uppercase;letter-spacing:0.06em;margin-top:4px;">${k.label}</div>
            </div>
        </td>`).join('');

    return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Reporte Diario — Operaciones</title></head>
<body style="margin:0;padding:0;background:${C.fondo};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:${C.fondo};">
<tr><td align="center" style="padding:32px 16px;">
<table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;">

  <!-- Header -->
  <tr><td style="background:${C.profundo};border-radius:16px 16px 0 0;padding:28px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td>
          <div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.5);
              text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">Compucad · Operaciones</div>
          <div style="font-size:22px;font-weight:700;color:${C.blanco};line-height:1.2;">
              Reporte Diario de Seguimiento</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.55);margin-top:6px;">${fecha}</div>
        </td>
        <td align="right" style="vertical-align:top;">
          <div style="width:44px;height:44px;border-radius:12px;background:${C.azul};
              display:inline-flex;align-items:center;justify-content:center;
              font-size:20px;">📦</div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Body -->
  <tr><td style="background:${C.blanco};padding:28px 32px;border-radius:0 0 16px 16px;
      box-shadow:0 2px 8px rgba(0,0,0,0.06);">

    <!-- KPIs -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
      <tr>${kpis}</tr>
    </table>

    <!-- Sección: Cotizaciones pendientes -->
    <div style="margin-bottom:24px;">
      <div style="display:flex;align-items:center;margin-bottom:12px;">
        <span style="display:inline-block;width:4px;height:18px;border-radius:2px;
            background:${C.amarillo};margin-right:10px;vertical-align:middle;"></span>
        <span style="font-size:15px;font-weight:700;color:${C.profundo};vertical-align:middle;">
            Cotizaciones Pendientes</span>
        <span style="margin-left:8px;display:inline-block;padding:2px 8px;border-radius:99px;
            font-size:10px;font-weight:700;color:${C.amarillo};background:${C.amarillo}20;
            border:1px solid ${C.amarillo}40;">${cotizaciones.length}</span>
      </div>
      ${tablaCotz}
    </div>

    <!-- Sección: Envíos creados -->
    <div style="margin-bottom:8px;">
      <div style="display:flex;align-items:center;margin-bottom:12px;">
        <span style="display:inline-block;width:4px;height:18px;border-radius:2px;
            background:${C.azul};margin-right:10px;vertical-align:middle;"></span>
        <span style="font-size:15px;font-weight:700;color:${C.profundo};vertical-align:middle;">
            Envíos en Estado "Creado"</span>
        <span style="margin-left:8px;display:inline-block;padding:2px 8px;border-radius:99px;
            font-size:10px;font-weight:700;color:${C.azul};background:${C.azul}20;
            border:1px solid ${C.azul}40;">${envios.length}</span>
      </div>
      ${tablaEnv}
    </div>

    <!-- Footer -->
    <div style="margin-top:28px;padding-top:20px;border-top:1px solid ${C.bordeSutil};
        text-align:center;font-size:11px;color:${C.gris};">
      Este correo es generado automáticamente por el sistema de Operaciones
      <a href="https://hubinn.compucad.com.mx/operaciones/paqueterias/envios"
         style="color:${C.azul};font-weight:600;text-decoration:none;">HUBINN</a>.<br>
      Lunes a viernes · 11:00 AM (CDMX)
    </div>

  </td></tr>

</table>
</td></tr>
</table>

</body>
</html>`;
}

// ─── Función principal del job ────────────────────────────────────────────────
async function ejecutarReporteDiario() {
    logger.info('[ReporteDiario] Iniciando consulta de datos...');

    try {
        const [cotizaciones, envios] = await Promise.all([
            prisma.cotizaciones.findMany({
                where: { status: 'PENDIENTE', deleted: false },
                include: { paqueteria: true },
                orderBy: { fecha: 'desc' },
            }),
            prisma.envios.findMany({
                where: { estado: 'CREADO', deleted: false },
                include: { paqueteria: true },
                orderBy: { fechaEnvio: 'desc' },
            }),
        ]);

        logger.info(`[ReporteDiario] Cotizaciones pendientes: ${cotizaciones.length} | Envíos creados: ${envios.length}`);

        const html = buildEmailHtml(cotizaciones, envios);
        const fecha = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });

        await transporter.sendMail({
            from: process.env.EMAIL_USER || 'transformacion.digital@compucad.com.mx',
            to: DESTINATARIO,
            subject: `📦 Reporte Diario Operaciones — ${fecha}`,
            html,
        });

        logger.info(`[ReporteDiario] Correo enviado a ${DESTINATARIO}`);
    } catch (error) {
        logger.error('[ReporteDiario] Error al ejecutar el reporte diario', error);
    }
}

// ─── Registro del cron ────────────────────────────────────────────────────────
export function iniciarReporteDiario() {
    // Lunes a viernes a las 11:00 AM (zona horaria México)
    cron.schedule('0 11 * * 1-5', ejecutarReporteDiario, {
        timezone: 'America/Mexico_City',
    });

    logger.info('[ReporteDiario] Cron registrado: lun-vie 11:00 AM (CDMX)');
}

// Exportar también la función para pruebas manuales
export { ejecutarReporteDiario };
