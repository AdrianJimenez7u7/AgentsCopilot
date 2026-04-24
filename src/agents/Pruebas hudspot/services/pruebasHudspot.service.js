import { AzureOpenAI } from 'openai';
import { transporter } from '../../../shared/config/email.config.js';
import { logger } from '../../../shared/utils/logger.js';

const DESTINATARIO = 'abraham.pardo@compucad.com.mx';
const BRAND_CONFIG = {
  copilot: {
    brand: 'Microsoft Copilot',
    family: 'microsoft',
    offering: 'licenciamiento, activacion, adopcion y gobierno de Microsoft Copilot',
    pitch: [
      'diagnostico de licenciamiento elegible',
      'seleccion de SKU correcta para M365 Copilot o Copilot Studio',
      'roadmap de adopcion por roles',
      'gobierno, seguridad y datos',
      'capacitacion ejecutiva y operativa',
      'acompanamiento para pilotos y despliegue'
    ],
    discoveryQuestions: [
      'Que licencias Microsoft 365 tiene hoy el cliente?',
      'Quiere productividad personal, agentes o automatizacion?',
      'Requiere gobierno, seguridad o integracion con datos internos?'
    ]
  },
  firefly: {
    brand: 'Adobe Firefly',
    family: 'adobe',
    offering: 'licenciamiento, adopcion creativa y gobierno de Adobe Firefly',
    pitch: [
      'definicion de la licencia adecuada de Adobe',
      'casos de uso para marketing, diseno y contenido',
      'lineamientos de marca y aprobacion creativa',
      'capacitacion para prompts, flujos y buenas practicas',
      'integracion con Creative Cloud',
      'acompanamiento en lanzamiento interno'
    ],
    discoveryQuestions: [
      'El uso principal sera generacion de imagen, video o piezas de marketing?',
      'Cuantos usuarios creativos participaran?',
      'Necesitan lineamientos de marca y aprobacion corporativa?'
    ]
  },
  autodesk: {
    brand: 'Autodesk',
    family: 'autodesk',
    offering: 'licenciamiento, implementacion y capacitacion especializada Autodesk',
    pitch: [
      'seleccion y cotizacion de licencias Autodesk',
      'revision de perfiles tecnicos y necesidades del equipo',
      'capacitacion funcional orientada al software requerido',
      'acompanamiento de onboarding tecnico',
      'recomendaciones de renovacion y optimizacion',
      'servicios complementarios de adopcion'
    ],
    discoveryQuestions: [
      'Que producto Autodesk necesita exactamente?',
      'Es compra nueva, renovacion o ampliacion?',
      'La solicitud incluye capacitacion, implementacion o soporte?'
    ]
  }
};

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function detectInterest(interes) {
  const text = normalizeText(interes);
  const matched = [];

  if (/(copilot|microsoft 365 copilot|copilot studio)/.test(text)) {
    matched.push(BRAND_CONFIG.copilot);
  }

  if (/(firefly|adobe)/.test(text)) {
    matched.push(BRAND_CONFIG.firefly);
  }

  if (/(autodesk|autocad|revit|civil 3d|inventor|fusion)/.test(text)) {
    matched.push(BRAND_CONFIG.autodesk);
  }

  const primary = matched[0] ?? {
    brand: 'Compucad',
    family: 'general',
    offering: 'acompanamiento comercial, consultivo y de adopcion',
    pitch: [
      'levantamiento de necesidad',
      'propuesta comercial consultiva',
      'recomendacion de marca, licenciamiento y servicios',
      'capacitacion y acompanamiento de adopcion'
    ],
    discoveryQuestions: [
      'Que resultado espera lograr el cliente?',
      'Cuantos usuarios participaran?',
      'La necesidad es compra, renovacion, implementacion o capacitacion?'
    ]
  };

  return {
    primary,
    matchedBrands: matched.map((item) => item.brand)
  };
}

function buildProposalEmail({ interes, profile, cliente, subject, summary, scope }) {
  const customerName = cliente?.nombre ? String(cliente.nombre).trim() : 'cliente';
  const text = [
    `Hola Abraham,`,
    '',
    `Se detecto una nueva solicitud ejemplo desde Pruebas hudspot.`,
    `Interes del cliente: ${interes}`,
    '',
    `Marca principal detectada: ${profile.brand}`,
    '',
    'Alcances sugeridos para Compucad:',
    ...profile.pitch.map((item, index) => `${index + 1}. ${capitalize(item)}.`),
    '',
    'Preguntas recomendadas para discovery:',
    ...profile.discoveryQuestions.map((item, index) => `${index + 1}. ${item}`),
    '',
    'Compucad puede convertir esta necesidad en una propuesta clara de licenciamiento, adopcion y valor de negocio.',
    '',
    'Mensaje generado automaticamente por la API de ejemplo.'
  ].join('\n');

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;background:#f4f7fb;padding:24px;">
      <div style="max-width:760px;margin:0 auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #dbe5f0;">
        <div style="background:linear-gradient(135deg,#0f4c81,#23a6d5);color:#ffffff;padding:28px 32px;">
          <div style="font-size:12px;letter-spacing:1.6px;text-transform:uppercase;opacity:.88;">Compucad | Pruebas hudspot</div>
          <h1 style="margin:10px 0 8px;font-size:28px;line-height:1.2;">Nueva oportunidad detectada: ${escapeHtml(profile.brand)}</h1>
          <p style="margin:0;font-size:16px;line-height:1.6;max-width:620px;">${escapeHtml(summary)}</p>
        </div>
        <div style="padding:32px;">
          <div style="margin-bottom:24px;padding:18px;border-radius:14px;background:#f6faff;border:1px solid #d9e9f7;">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#0f4c81;margin-bottom:8px;">Interes recibido</div>
            <div style="font-size:18px;color:#15324b;font-weight:600;">${escapeHtml(interes)}</div>
          </div>
          <h2 style="color:#15324b;font-size:20px;margin:0 0 14px;">Como puede ayudar Compucad</h2>
          <ul style="padding-left:22px;color:#31475d;line-height:1.8;margin:0 0 24px;">
            ${profile.pitch.map((item) => `<li>${escapeHtml(capitalize(item))}</li>`).join('')}
          </ul>
          <h2 style="color:#15324b;font-size:20px;margin:0 0 14px;">Preguntas para acelerar el cierre</h2>
          <ol style="padding-left:22px;color:#31475d;line-height:1.8;margin:0 0 28px;">
            ${profile.discoveryQuestions.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
          </ol>
          <div style="padding:18px 20px;border-radius:14px;background:#0f172a;color:#e2e8f0;">
            <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#7dd3fc;margin-bottom:8px;">Siguiente movimiento sugerido</div>
            <div style="font-size:16px;line-height:1.7;">Agendar una llamada de discovery y construir una propuesta integral que combine licenciamiento, adopcion, capacitacion y acompanamiento comercial.</div>
          </div>
        </div>
      </div>
    </div>
  `;

  return {
    subject,
    text,
    html,
    summary,
    scope
  };
}

function buildDeterministicProposal({ interes, profile, cliente }) {
  const customerName = cliente?.nombre ? String(cliente.nombre).trim() : 'cliente';
  const summary = `El cliente manifesto interes en ${interes}. Compucad puede responder con una propuesta consultiva alrededor de ${profile.brand}.`;
  const scope = [
    `Asesoria comercial para ${profile.offering}.`,
    `Revision del escenario actual del ${customerName} para identificar licencias, capacidades y brechas.`,
    `Propuesta de servicios de adopcion, capacitacion y acompanamiento a la medida.`,
    'Siguiente paso sugerido: discovery de 20 a 30 minutos para afinar alcance, usuarios y tiempos.'
  ];
  const subject = `Propuesta Compucad para oportunidad ${profile.brand}`;

  return buildProposalEmail({
    interes,
    profile,
    cliente,
    subject,
    summary,
    scope
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function capitalize(value) {
  const text = String(value ?? '').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

async function generateProposalWithAI({ interes, profile, cliente, metadata }) {
  const endpoint = process.env.AZURE_OPENAI_5_MINI_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_5_MINI_API_KEY || process.env.AZURE_API_KEY;
  const apiVersion = process.env.AZURE_OPENAI_5_MINI_API_VERSION || process.env.AZURE_OPENAI_API_VERSION;
  const deployment = process.env.AZURE_OPENAI_5_MINI_MODEL || process.env.AZURE_OPENAI_MODEL;

  if (!endpoint || !apiKey || !apiVersion || !deployment) {
    throw new Error('Azure OpenAI no esta configurado para generar la propuesta.');
  }

  const client = new AzureOpenAI({ endpoint, apiKey, apiVersion, deployment });
  const customerContext = JSON.stringify(cliente ?? {}, null, 2);
  const metadataContext = JSON.stringify(metadata ?? {}, null, 2);
  const isGpt5Model = /gpt-5/i.test(deployment);

  const systemPrompt = `
Eres un arquitecto comercial senior de Compucad. Debes transformar una intencion comercial en una propuesta ejecutiva impresionante, concreta y vendible.

Responde exclusivamente en JSON valido con esta estructura:
{
  "subject": "string",
  "summary": "string",
  "scope": ["string"],
  "agentTips": ["string"],
  "nextBestActions": ["string"]
}

Reglas:
- El contenido debe sonar premium, consultivo y accionable.
- Debe enfocarse en como Compucad ayuda con licenciamiento, implementacion, adopcion, capacitacion y acompanamiento.
- No inventes precios ni promesas contractuales.
- La respuesta debe ser en espanol.
-
- "summary" debe tener maximo 45 palabras.
- "scope" debe traer exactamente 4 puntos.
- "agentTips" debe traer exactamente 3 puntos.
- "nextBestActions" debe traer exactamente 3 puntos.
  `.trim();

  const userPrompt = `
Interes detectado del cliente:
${interes}

Marca principal:
${profile.brand}

Familia:
${profile.family}

Capacidades base de Compucad para este caso:
${profile.pitch.map((item) => `- ${item}`).join('\n')}

Preguntas de discovery recomendadas:
${profile.discoveryQuestions.map((item) => `- ${item}`).join('\n')}

Datos del cliente:
${customerContext}

Metadata de la llamada:
${metadataContext}
  `.trim();

  const request = {
    model: deployment,
    response_format: { type: 'json_object' },
    max_completion_tokens: isGpt5Model ? 1400 : 700,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  };

  if (isGpt5Model) {
    request.reasoning_effort = 'low';
  }

  const response = await client.chat.completions.create(request);
  const finishReason = response.choices?.[0]?.finish_reason;
  const content = response.choices?.[0]?.message?.content ?? '';

  if (!content.trim()) {
    throw new Error(`Respuesta vacia del modelo. finish_reason=${finishReason || 'unknown'}`);
  }

  return JSON.parse(content);
}

async function sendProposalEmail({ subject, text, html }) {
  const info = await transporter.sendMail({
    from: process.env.EMAIL_USER || 'transformacion.digital@compucad.com.mx',
    to: DESTINATARIO,
    subject,
    text,
    html
  });

  return {
    accepted: info.accepted ?? [],
    rejected: info.rejected ?? [],
    messageId: info.messageId ?? null
  };
}

export class PruebasHudspotService {
  static async procesarSolicitud({ interes, cliente, metadata }) {
    const detected = detectInterest(interes);
    let proposal = buildDeterministicProposal({
      interes,
      profile: detected.primary,
      cliente
    });
    let generationMode = 'fallback';

    try {
      const aiProposal = await generateProposalWithAI({
        interes,
        profile: detected.primary,
        cliente,
        metadata
      });

      if (aiProposal?.subject && aiProposal?.summary) {
        const aiScope = Array.isArray(aiProposal.scope) && aiProposal.scope.length ? aiProposal.scope : proposal.scope;
        proposal = {
          ...buildProposalEmail({
            interes,
            profile: detected.primary,
            cliente,
            subject: aiProposal.subject,
            summary: aiProposal.summary,
            scope: aiScope
          }),
          agentTips: Array.isArray(aiProposal.agentTips) ? aiProposal.agentTips : [],
          nextBestActions: Array.isArray(aiProposal.nextBestActions) ? aiProposal.nextBestActions : []
        };
        generationMode = 'azure-openai';
      }
    } catch (error) {
      logger.warn('No se pudo generar la propuesta con IA; se usara plantilla deterministica.', {
        message: error.message
      });
    }

    const emailResult = await sendProposalEmail(proposal);
    const recommendedReply = `Gracias, ${cliente?.nombre || 'cliente'}. Ya comparti internamente tu interes en ${detected.primary.brand} para preparar una propuesta de valor desde Compucad. Podemos ayudarte con ${proposal.scope[0].toLowerCase()} y acompañarte con capacitacion, adopcion y definicion del mejor siguiente paso comercial.`;
    const nextBestActions = proposal.nextBestActions?.length
      ? proposal.nextBestActions
      : [
          'Confirmar cantidad de usuarios o licencias requeridas.',
          'Validar si se trata de compra nueva, renovacion o capacitacion.',
          'Solicitar una llamada de discovery para construir la propuesta comercial.'
        ];
    const agentTips = proposal.agentTips?.length
      ? proposal.agentTips
      : [
          'Pregunta por urgencia, numero de usuarios y fecha objetivo.',
          'Si el cliente habla de adopcion, sugiere capacitacion y acompanamiento.',
          'Si el cliente habla de licencias, sugiere validar escenario actual antes de cotizar.'
        ];

    return {
      interesOriginal: interes,
      marcaDetectada: detected.primary.brand,
      marcasCoincidentes: detected.matchedBrands,
      respuestaAgente: {
        mensaje: recommendedReply,
        tono: 'consultivo-comercial',
        siguientePreguntaSugerida: detected.primary.discoveryQuestions[0],
        siguientesAcciones: nextBestActions
      },
      propuesta: {
        resumen: proposal.summary,
        alcances: proposal.scope
      },
      email: {
        enviadoA: DESTINATARIO,
        subject: proposal.subject,
        generationMode,
        ...emailResult
      },
      agentContext: {
        objetivo: 'Ayudar al agente llamador a decidir el siguiente paso comercial.',
        recommendedReply,
        discoveryQuestions: detected.primary.discoveryQuestions,
        nextBestActions,
        agentTips
      }
    };
  }
}
