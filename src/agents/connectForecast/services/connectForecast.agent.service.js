import { AzureOpenAI } from 'openai';
import { ConnectForecastDataverseService } from './dataverse.service.js';

const DEFAULT_SELECT = [
  'opportunityid',
  'name',
  '_cad_un_value',
  '_customerid_value',
  '_ownerid_value',
  'estimatedvalue',
  'estimatedclosedate',
  'closeprobability',
  'statuscode',
  'statecode',
  'createdon'
].join(',');

const EXCLUDED_AREA_NAMES = new Set([
  'MICROSOFT',
  'COMPUCLOUD',
  'GESTION DE TALENTO',
  'ADOBE',
  'AUTODESK',
  'MENSAJERIA'
]);

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeArea(value) {
  return normalizeText(value).trim().toUpperCase();
}

function isExcludedArea(value) {
  const normalized = normalizeArea(value);
  return normalized.startsWith('ERROR') || EXCLUDED_AREA_NAMES.has(normalized);
}

function getFormatted(row, field) {
  return row[`${field}@OData.Community.Display.V1.FormattedValue`] ?? row[field] ?? null;
}

function getNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function startOfLastDays(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function startOfCurrentMonth() {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function aggregate(rows, groupBy) {
  const groups = new Map();

  for (const row of rows) {
    const key = groupBy ? (getFormatted(row, groupBy.field) || 'Sin asignar') : 'Total';
    const current = groups.get(key) || {
      key,
      count: 0,
      estimatedValue: 0,
      probabilityTotal: 0
    };

    current.count += 1;
    current.estimatedValue += getNumber(row.estimatedvalue);
    current.probabilityTotal += getNumber(row.closeprobability);
    groups.set(key, current);
  }

  return [...groups.values()].map((item) => ({
    key: item.key,
    count: item.count,
    estimatedValue: Number(item.estimatedValue.toFixed(2)),
    averageProbability: item.count ? Number((item.probabilityTotal / item.count).toFixed(2)) : 0
  }));
}

function buildAreasTomadasEnCuenta(rows) {
  const names = new Set();

  for (const row of rows) {
    const name = getFormatted(row, '_cad_un_value') || 'Sin area';
    names.add(name);
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

function buildAzureFoundryTokenUsage(usage) {
  return Number(usage?.total_tokens ?? usage?.totalTokens ?? 0) || 0;
}

function getAzureEndpoint() {
  const endpoint = process.env.AZURE_OPENAI_5_MINI_ENDPOINT
    || process.env.AZURE_OPENAI_ENDPOINT
    || '';

  return endpoint
    .replace(/\/openai\/deployments\/.*$/i, '')
    .replace(/\/$/, '');
}

function getIntentSystemPrompt() {
  return [
    'Eres un analizador de preguntas para un dashboard de oportunidades de CRM Dataverse.',
    'Tu tarea es convertir la pregunta del usuario a JSON valido.',
    'No respondas la pregunta final, solo clasifica la intencion.',
    'Campos disponibles:',
    '- oportunidades: opportunity',
    '- fechas: createdon como fecha base para periodos',
    '- estados: open=abiertas, won=ganadas, lost=perdidas, all=todas',
    '- agrupaciones: owner=responsable/vendedor, area=unidad de negocio/cad_un, customer=cliente/cuenta, none=sin agrupacion',
    '- metricas: count=cantidad, estimatedValue=valor/monto estimado, averageProbability=probabilidad promedio',
    'Si la pregunta no se puede responder con esos campos, marca isAnswerable=false.',
    'Si la pregunta tiene sentido pero no especifica periodo, usa period=all.',
    'Si pide "ultimo mes" o equivalente, usa period=last_30_days.',
    'Si pide "este mes", usa period=current_month.',
    'Si pide el mayor/mas/top, order=desc. Si pide menor/menos/bottom, order=asc.',
    'Extrae areas si el usuario menciona unidades de negocio especificas.',
    'Responde solo JSON con esta forma:',
    '{"isAnswerable":true,"reason":"","metric":"count|estimatedValue|averageProbability","groupBy":"owner|area|customer|none","state":"open|won|lost|all","period":"all|last_30_days|current_month","order":"desc|asc","limit":10,"areas":[]}'
  ].join('\n');
}

function parseJsonObject(text) {
  const raw = String(text ?? '').trim();
  if (!raw) {
    throw new Error('Azure Foundry no devolvio una intencion valida.');
  }

  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new Error('Azure Foundry no devolvio JSON valido.');
    }

    return JSON.parse(raw.slice(start, end + 1));
  }
}

function normalizeIntent(intent = {}) {
  const allowedMetrics = new Set(['count', 'estimatedValue', 'averageProbability']);
  const allowedGroupBy = new Set(['owner', 'area', 'customer', 'none']);
  const allowedStates = new Set(['open', 'won', 'lost', 'all']);
  const allowedPeriods = new Set(['all', 'last_30_days', 'current_month']);
  const allowedOrders = new Set(['desc', 'asc']);

  return {
    isAnswerable: intent.isAnswerable !== false,
    reason: String(intent.reason || '').trim(),
    metric: allowedMetrics.has(intent.metric) ? intent.metric : 'count',
    groupBy: allowedGroupBy.has(intent.groupBy) ? intent.groupBy : 'none',
    state: allowedStates.has(intent.state) ? intent.state : 'all',
    period: allowedPeriods.has(intent.period) ? intent.period : 'all',
    order: allowedOrders.has(intent.order) ? intent.order : 'desc',
    limit: Math.min(Math.max(Number.parseInt(intent.limit, 10) || 10, 1), 25),
    areas: Array.isArray(intent.areas)
      ? intent.areas.map((area) => String(area).trim()).filter(Boolean)
      : []
  };
}

function periodToFilter(period) {
  if (period === 'last_30_days') {
    return { label: 'ultimos 30 dias', createdFrom: startOfLastDays(30).toISOString() };
  }

  if (period === 'current_month') {
    return { label: 'mes actual', createdFrom: startOfCurrentMonth().toISOString() };
  }

  return { label: 'historico', createdFrom: null };
}

function stateToFilter(state) {
  const states = {
    open: { label: 'abiertas', stateCode: 0 },
    won: { label: 'ganadas', stateCode: 1 },
    lost: { label: 'perdidas', stateCode: 2 },
    all: { label: 'todas', stateCode: null }
  };

  return states[state] || states.all;
}

function groupByToField(groupBy) {
  const groups = {
    owner: { field: '_ownerid_value', label: 'responsable' },
    area: { field: '_cad_un_value', label: 'area' },
    customer: { field: '_customerid_value', label: 'cliente' },
    none: null
  };

  return groups[groupBy] || null;
}

function metricToLabel(metric) {
  const metrics = {
    count: { key: 'count', label: 'cantidad' },
    estimatedValue: { key: 'estimatedValue', label: 'valor estimado' },
    averageProbability: { key: 'averageProbability', label: 'probabilidad promedio' }
  };

  return metrics[metric] || metrics.count;
}

function buildAnswer({ rows, groupBy, metric, order, state, period, ranking }) {
  const metricLabel = metric.label;

  if (!groupBy) {
    if (rows.length === 0) {
      return `La pregunta es valida, pero no encontre oportunidades ${state.label} que coincidan con los filtros indicados.`;
    }

    return `Encontré ${rows.length} oportunidades ${state.label} en el periodo ${period.label}.`;
  }

  const top = ranking[0];
  if (!top) {
    return `La pregunta es valida, pero no encontre oportunidades ${state.label} que coincidan con los filtros indicados.`;
  }

  const orderText = order === 'asc' ? 'menos' : 'mas';
  const value = metric.key === 'count'
    ? top.count
    : metric.key === 'estimatedValue'
      ? Number(top.estimatedValue.toFixed(2))
      : top.averageProbability;

  return `El ${groupBy.label} con ${orderText} ${metricLabel} es ${top.key}, con ${value}.`;
}

export class ConnectForecastAgentService {
  constructor() {
    this.dataverseService = new ConnectForecastDataverseService();
    this.azureClient = new AzureOpenAI({
      endpoint: getAzureEndpoint(),
      apiKey: process.env.AZURE_OPENAI_5_MINI_API_KEY || process.env.AZURE_API_KEY || process.env.OPENAI_API_KEY,
      apiVersion: process.env.AZURE_OPENAI_5_MINI_API_VERSION || process.env.AZURE_OPENAI_API_VERSION,
      deployment: process.env.AZURE_OPENAI_5_MINI_MODEL || process.env.AZURE_OPENAI_MODEL
    });
    this.azureModel = process.env.AZURE_OPENAI_5_MINI_MODEL || process.env.AZURE_OPENAI_MODEL;
  }

  async analyzeQuestion(question) {
    const response = await this.azureClient.chat.completions.create({
      model: this.azureModel,
      messages: [
        { role: 'system', content: getIntentSystemPrompt() },
        { role: 'user', content: String(question) }
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 800
    });
    const intent = normalizeIntent(parseJsonObject(response.choices?.[0]?.message?.content));

    return {
      intent,
      usage: response.usage || {}
    };
  }

  buildQuery(intent, body = {}) {
    const period = periodToFilter(intent.period);
    const state = stateToFilter(intent.state);
    const bodyAreas = body.areas || body.area || body.cad_un || body.cad_UN;
    const intentAreas = intent.areas?.length ? intent.areas : null;

    return {
      select: DEFAULT_SELECT,
      createdFrom: body.createdFrom || period.createdFrom,
      createdTo: body.createdTo,
      stateCode: body.stateCode ?? state.stateCode ?? undefined,
      areas: bodyAreas || intentAreas,
      maxRows: body.maxRows
    };
  }

  async ask({ question, ...body }) {
    if (!question || !String(question).trim()) {
      throw new Error('Falta question en el body.');
    }

    const { intent, usage } = await this.analyzeQuestion(question);
    const tokensAzureFoundry = buildAzureFoundryTokenUsage(usage);

    if (!intent.isAnswerable) {
      return {
        answer: intent.reason || 'No puedo responder esa pregunta con la informacion disponible de oportunidades.',
        result: null,
        areasTomadasEnCuenta: [],
        tokensAzureFoundry
      };
    }

    const groupBy = groupByToField(intent.groupBy);
    const metric = metricToLabel(intent.metric);
    const order = intent.order;
    const period = periodToFilter(intent.period);
    const state = stateToFilter(intent.state);
    const query = this.buildQuery(intent, body);
    const maxRows = Math.min(Number(body.maxRows) || 5000, 10000);
    const rows = await this.dataverseService.getAllOpportunities(query, { maxRows });
    const filteredRows = rows.filter((row) => !isExcludedArea(getFormatted(row, '_cad_un_value')));
    const summary = aggregate(filteredRows, null)[0] || {
      count: 0,
      estimatedValue: 0,
      averageProbability: 0
    };
    const ranking = groupBy
      ? aggregate(filteredRows, groupBy)
        .sort((a, b) => {
          const diff = a[metric.key] - b[metric.key];
          return order === 'asc' ? diff : -diff;
        })
        .slice(0, Number(body.limit) || 10)
      : [];

    const result = groupBy
      ? { ranking }
      : {
          summary: {
            count: summary.count,
            estimatedValue: Number(summary.estimatedValue.toFixed(2)),
            averageProbability: summary.averageProbability
          }
        };

    return {
      answer: buildAnswer({
        rows: filteredRows,
        groupBy,
        metric,
        order,
        state,
        period,
        ranking
      }),
      result,
      areasTomadasEnCuenta: buildAreasTomadasEnCuenta(filteredRows),
      tokensAzureFoundry
    };
  }
}
