import { transporter } from '../../../shared/config/email.config.js';
import { logger } from '../../../shared/utils/logger.js';

// ─── Paleta Compucad ─────────────────────────────────────────────────────────
const C = {
    azul:      '#003567',
    profundo:  '#0C1C33',
    verde:     '#4E901F',
    rojo:      '#EE2737',
    gris:      '#47484D',
    blanco:    '#FBFBFF',
    fondo:     '#F5F7FA',
    bordeSutil:'rgba(0,53,103,0.06)',
    zebra:     'rgba(0,53,103,0.012)',
};

const formatDate = (d) => d
    ? new Date(d).toLocaleString('es-MX', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City'
      })
    : '—';

const formatMoney = (n) => n != null
    ? `$${Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2 })} MXN`
    : '—';

// ─── Timeline de eventos DHL ──────────────────────────────────────────────────
function buildDhlTimeline(events = []) {
    if (!events.length) return '';

    const rows = events.slice(0, 8).map((ev, i) => {
        const isFirst = i === 0;
        const location = ev.location?.address?.addressLocality
            ?? ev.serviceArea?.[0]?.description
            ?? '';
        return `
        <tr>
          <td style="padding:10px 12px 10px 0;vertical-align:top;width:140px;">
            <div style="font-size:11px;font-weight:600;color:${isFirst ? C.verde : C.gris};">
              ${formatDate(ev.timestamp)}</div>
            ${location ? `<div style="font-size:10px;color:${C.gris};margin-top:2px;">${location}</div>` : ''}
          </td>
          <td style="padding:10px 0 10px 16px;vertical-align:top;border-left:2px solid ${isFirst ? C.verde : C.bordeSutil};">
            <div style="width:8px;height:8px;border-radius:50%;background:${isFirst ? C.verde : C.gris};
                display:inline-block;margin-left:-20px;margin-right:10px;vertical-align:middle;"></div>
            <span style="font-size:12px;color:${isFirst ? C.profundo : C.gris};
                font-weight:${isFirst ? '600' : '400'};vertical-align:middle;">
              ${ev.description ?? ''}
            </span>
          </td>
        </tr>`;
    }).join('');

    return `
    <div style="margin-top:24px;">
      <div style="font-size:13px;font-weight:700;color:${C.profundo};margin-bottom:12px;">
        Historial de rastreo DHL
      </div>
      <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    </div>`;
}

// ─── HTML del correo de entrega ───────────────────────────────────────────────
function buildEntregaHtml(envio, trackingData) {
    const paqueteria = envio.paqueteria?.nombre ?? envio.cotizacion?.paqueteria?.nombre ?? '—';
    const guias = (envio.guias ?? []).map(g => g.numeroGuia);
    const events = trackingData?.shipments?.[0]?.events ?? [];

    const aprobador = envio.cotizacion?.reviewedBy ?? null;

    const detalle = [
        ['Folio de envío',        `#${envio.id}`],
        ['Solicitante',           envio.usuario],
        ['Paquetería',            paqueteria],
        ...(envio.empresaOrigen ? [['Empresa origen', envio.empresaOrigen]] : []),
        ['Origen',                `${envio.ciudadOrigen ?? '—'} (${envio.cpOrigen ?? ''})`],
        ...(envio.empresaDestino ? [['Empresa destino', envio.empresaDestino]] : []),
        ['Destino',               `${envio.ciudadDestino ?? '—'} (${envio.cpDestino ?? ''})`],
        ['Costo',                 formatMoney(envio.costoEnvio)],
        ['Fecha de envío',        formatDate(envio.fechaEnvio)],
        ...(guias.length ? [['Guía(s)', guias.join(', ')]] : []),
        ...(aprobador ? [['Aprobado por', aprobador]] : []),
        ['Última actualización',  formatDate(envio.updatedAt)],
    ].map(([label, value], i) => `
        <tr style="background:${i % 2 === 1 ? C.zebra : 'transparent'};">
          <td style="padding:8px 12px;font-size:11px;font-weight:600;color:${C.gris};
              text-transform:uppercase;letter-spacing:0.05em;width:38%;
              border-bottom:1px solid ${C.bordeSutil};">${label}</td>
          <td style="padding:8px 12px;font-size:12px;color:${C.profundo};
              border-bottom:1px solid ${C.bordeSutil};">${value}</td>
        </tr>`).join('');

    const timeline = buildDhlTimeline(events);

    return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Tu envío fue entregado</title></head>
<body style="margin:0;padding:0;background:${C.fondo};
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:${C.fondo};">
<tr><td align="center" style="padding:32px 16px;">
<table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">

  <!-- Header verde: entregado -->
  <tr><td style="background:${C.verde};border-radius:16px 16px 0 0;padding:28px 32px;">
    <div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.65);
        text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">
      Compucad · Operaciones</div>
    <div style="font-size:24px;font-weight:700;color:#fff;line-height:1.2;">
      ✓ Tu envío fue entregado</div>
    <div style="font-size:13px;color:rgba(255,255,255,0.75);margin-top:6px;">
      ${formatDate(new Date())}</div>
  </td></tr>

  <!-- Body -->
  <tr><td style="background:${C.blanco};padding:28px 32px;border-radius:0 0 16px 16px;
      box-shadow:0 2px 8px rgba(0,0,0,0.06);">

    <p style="font-size:14px;color:${C.profundo};line-height:1.55;margin:0 0 20px;">
      Tu envío ha sido marcado como <strong>Entregado</strong>.
      A continuación encontrarás el resumen del servicio.</p>

    <!-- Tabla de detalle -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;
        border-radius:10px;overflow:hidden;border:1px solid ${C.bordeSutil};margin-bottom:4px;">
      <tbody>${detalle}</tbody>
    </table>

    ${timeline}

    <!-- Footer -->
    <div style="margin-top:28px;padding-top:20px;border-top:1px solid ${C.bordeSutil};
        text-align:center;font-size:11px;color:${C.gris};">
      Este correo es generado automáticamente por el sistema de Operaciones Compucad.
    </div>

  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ─── HTML del correo de rechazo de cotización ─────────────────────────────────
function buildRechazoHtml(cotizacion) {
    const paqueteria = cotizacion.paqueteria?.nombre ?? '—';
    const motivo = cotizacion.motivoRechazo ?? 'No se especificó un motivo.';

    const detalle = [
        ['Folio de cotización',   `#${cotizacion.id}`],
        ['Solicitante',           cotizacion.usuario],
        ['Unidad de negocio',     cotizacion.unidadNegocio ?? '—'],
        ['Paquetería',            paqueteria],
        ['Tipo de servicio',      cotizacion.serviceType ?? '—'],
        ...(cotizacion.empresaOrigen ? [['Empresa origen', cotizacion.empresaOrigen]] : []),
        ['Origen',                `${cotizacion.ciudadOrigen ?? '—'} (${cotizacion.cpOrigen ?? ''})`],
        ...(cotizacion.empresaDestino ? [['Empresa destino', cotizacion.empresaDestino]] : []),
        ['Destino',               `${cotizacion.ciudadDestino ?? '—'} (${cotizacion.cpDestino ?? ''})`],
        ['Peso',                  cotizacion.peso != null ? `${cotizacion.peso} kg` : '—'],
        ['Costo estimado',        formatMoney(cotizacion.costoEstimado)],
        ['Fecha de creación',     formatDate(cotizacion.createdAt ?? cotizacion.fecha)],
        ...(cotizacion.reviewedBy ? [['Rechazada por', cotizacion.reviewedBy]] : []),
        ['Fecha de rechazo',      formatDate(cotizacion.reviewedAt)],
    ].map(([label, value], i) => `
        <tr style="background:${i % 2 === 1 ? C.zebra : 'transparent'};">
          <td style="padding:8px 12px;font-size:11px;font-weight:600;color:${C.gris};
              text-transform:uppercase;letter-spacing:0.05em;width:38%;
              border-bottom:1px solid ${C.bordeSutil};">${label}</td>
          <td style="padding:8px 12px;font-size:12px;color:${C.profundo};
              border-bottom:1px solid ${C.bordeSutil};">${value}</td>
        </tr>`).join('');

    return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Tu cotización fue rechazada</title></head>
<body style="margin:0;padding:0;background:${C.fondo};
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="background:${C.fondo};">
<tr><td align="center" style="padding:32px 16px;">
<table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">

  <!-- Header rojo: rechazada -->
  <tr><td style="background:${C.rojo};border-radius:16px 16px 0 0;padding:28px 32px;">
    <div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.7);
        text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px;">
      Compucad · Operaciones</div>
    <div style="font-size:24px;font-weight:700;color:#fff;line-height:1.2;">
      Tu cotización fue rechazada</div>
    <div style="font-size:13px;color:rgba(255,255,255,0.8);margin-top:6px;">
      ${formatDate(cotizacion.reviewedAt ?? new Date())}</div>
  </td></tr>

  <!-- Body -->
  <tr><td style="background:${C.blanco};padding:28px 32px;border-radius:0 0 16px 16px;
      box-shadow:0 2px 8px rgba(0,0,0,0.06);">

    <p style="font-size:14px;color:${C.profundo};line-height:1.55;margin:0 0 20px;">
      Tu solicitud de cotización de envío fue <strong>rechazada</strong>.
      A continuación encontrarás el motivo y el detalle del registro.</p>

    <!-- Motivo destacado -->
    <div style="background:rgba(238,39,55,0.06);border-left:4px solid ${C.rojo};
        border-radius:8px;padding:14px 16px;margin-bottom:24px;">
      <div style="font-size:11px;font-weight:700;color:${C.rojo};
          text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">
        Motivo del rechazo</div>
      <div style="font-size:13px;color:${C.profundo};line-height:1.5;">${motivo}</div>
    </div>

    <!-- Tabla de detalle -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;
        border-radius:10px;overflow:hidden;border:1px solid ${C.bordeSutil};margin-bottom:4px;">
      <tbody>${detalle}</tbody>
    </table>

    <!-- Footer -->
    <div style="margin-top:28px;padding-top:20px;border-top:1px solid ${C.bordeSutil};
        text-align:center;font-size:11px;color:${C.gris};">
      Este correo es generado automáticamente por el sistema de Operaciones Compucad.
    </div>

  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

// ─── API pública ──────────────────────────────────────────────────────────────
export class EmailService {

    /**
     * Notifica al solicitante que su envío fue entregado.
     * @param {object} envio      - Objeto envío con relaciones (paqueteria, guias, etc.)
     * @param {object|null} trackingData - Respuesta de DHL trackShipment (null si no aplica)
     */
    static async notificarEntrega(envio, trackingData = null) {
        const destinatario = envio.usuario;
        if (!destinatario) {
            logger.warn('[EmailService] No se pudo enviar notificación: envio.usuario está vacío');
            return;
        }

        const paqueteria = envio.paqueteria?.nombre ?? envio.cotizacion?.paqueteria?.nombre ?? '';
        const html = buildEntregaHtml(envio, trackingData);

        await transporter.sendMail({
            from: process.env.EMAIL_USER || 'transformacion.digital@compucad.com.mx',
            to: destinatario,
            subject: `✓ Tu envío #${envio.id} fue entregado${paqueteria ? ` · ${paqueteria}` : ''}`,
            html,
        });

        logger.info(`[EmailService] Notificación de entrega enviada a ${destinatario} (envío #${envio.id})`);
    }

    /**
     * Notifica al solicitante que su cotización fue rechazada, incluyendo el motivo
     * y los datos de la cotización con su fecha de creación.
     * @param {object} cotizacion - Cotización rechazada (con motivoRechazo, reviewedBy, reviewedAt y paqueteria).
     */
    static async notificarRechazoCotizacion(cotizacion) {
        const destinatario = cotizacion.usuario;
        if (!destinatario) {
            logger.warn('[EmailService] No se pudo enviar notificación de rechazo: cotizacion.usuario está vacío');
            return;
        }

        const html = buildRechazoHtml(cotizacion);

        await transporter.sendMail({
            from: process.env.EMAIL_USER || 'transformacion.digital@compucad.com.mx',
            to: destinatario,
            subject: `Tu cotización #${cotizacion.id} fue rechazada`,
            html,
        });

        logger.info(`[EmailService] Notificación de rechazo enviada a ${destinatario} (cotización #${cotizacion.id})`);
    }
}
