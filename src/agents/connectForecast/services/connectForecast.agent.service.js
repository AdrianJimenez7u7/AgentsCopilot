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
  'createdon',
  'cad_utilidad',
  'cad_bigdeal',
  'cr2bd_tipodecontrato',
  '_cad_tipodeproyecto_value',
  'cad_cantidad1',
  'new_costohardware'
].join(',');

// Catalogo de razones de estatus (statuscode) de opportunity en Dataverse.
// Obtenido via Microsoft.Dynamics.CRM.StatusAttributeMetadata; no cambia salvo que se edite el optionset en el CRM.
const STATUS_REASON_OPTIONS = [
  { value: 1, state: 0, label: 'En curso' },
  { value: 2, state: 0, label: 'Retenido' },
  { value: 200000, state: 0, label: 'Open for Bidding' },
  { value: 3, state: 1, label: 'Ganado' },
  { value: 4, state: 2, label: 'Cliente no avanzo/ sin prioridad' },
  { value: 5, state: 2, label: 'Compro con otro proveedor' },
  { value: 535870003, state: 2, label: 'Compro directo con fabricante' },
  { value: 535870004, state: 2, label: 'Precio fuera de presupuesto' },
  { value: 535870005, state: 2, label: 'Proyecto detenido' },
  { value: 535870006, state: 2, label: 'No se logro contactar al cliente' },
  { value: 535870007, state: 2, label: 'No hubo seguimiento del cliente / Dejo de responder' },
  { value: 535870008, state: 2, label: 'Registro/ Oportunidad duplicada' },
  { value: 535870009, state: 2, label: 'Revendedor' }
];

// Catalogo de Tipo de Contrato (cr2bd_tipodecontrato) de opportunity en Dataverse.
// Obtenido via Microsoft.Dynamics.CRM.PicklistAttributeMetadata; no cambia salvo que se edite el optionset en el CRM.
const TIPO_CONTRATO_OPTIONS = [
  { value: 1, label: 'Nuevo' },
  { value: 2, label: 'Renovación' },
  { value: 3, label: 'Anexo' },
  { value: 4, label: 'Extensión' },
  { value: 5, label: 'Convenio modificatorio' }
];

const MONTH_NAMES_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeStatusLabel(value) {
  return normalizeText(value).trim().replace(/\s+/g, ' ');
}

function findStatusReason(input) {
  const raw = String(input ?? '').trim();
  if (!raw) {
    return null;
  }

  if (/^\d+$/.test(raw)) {
    const numericValue = Number(raw);
    return STATUS_REASON_OPTIONS.find((option) => option.value === numericValue) || null;
  }

  const normalized = normalizeStatusLabel(raw);
  return STATUS_REASON_OPTIONS.find((option) => normalizeStatusLabel(option.label) === normalized) || null;
}

function describeStatusReasonOptions() {
  return STATUS_REASON_OPTIONS.map((option) => `"${option.label}"`).join(', ');
}

// Filtro explicito (manual o body): un valor no reconocido es un error del usuario, se rechaza.
function resolveStatusReasonStrict(input) {
  const match = findStatusReason(input);
  if (!match) {
    throw new Error(`El estatus "${input}" no es valido. Valores permitidos: ${describeStatusReasonOptions()}.`);
  }

  return match;
}

// Filtro inferido por el modelo (modo automatico): si alucina un valor, se ignora en vez de fallar la consulta.
function resolveStatusReasonLenient(input) {
  return findStatusReason(input);
}

function findTipoContrato(input) {
  const raw = String(input ?? '').trim();
  if (!raw) {
    return null;
  }

  if (/^\d+$/.test(raw)) {
    const numericValue = Number(raw);
    return TIPO_CONTRATO_OPTIONS.find((option) => option.value === numericValue) || null;
  }

  const normalized = normalizeStatusLabel(raw);
  return TIPO_CONTRATO_OPTIONS.find((option) => normalizeStatusLabel(option.label) === normalized) || null;
}

function describeTipoContratoOptions() {
  return TIPO_CONTRATO_OPTIONS.map((option) => `"${option.label}"`).join(', ');
}

// Filtro explicito (manual o body): un valor no reconocido es un error del usuario, se rechaza.
function resolveTipoContratoStrict(input) {
  const match = findTipoContrato(input);
  if (!match) {
    throw new Error(`El tipo de contrato "${input}" no es valido. Valores permitidos: ${describeTipoContratoOptions()}.`);
  }

  return match;
}

// Filtro inferido por el modelo (modo automatico): si alucina un valor, se ignora en vez de fallar la consulta.
function resolveTipoContratoLenient(input) {
  return findTipoContrato(input);
}

// Si el body trae cualquiera de estos filtros explicitos, la pregunta ya no puede
// considerarse "ambigua": el usuario esta operando en modo manual y el body siempre
// gana sobre lo que el modelo haya podido inferir (o fallar en inferir) del texto.
const MANUAL_OVERRIDE_KEYS = new Set([
  'tipoProyecto', 'tipoProyectos', 'projectType', 'segment',
  'areas', 'area', 'cad_un', 'cad_UN',
  'tipoContrato', 'contractType', 'cr2bd_tipodecontrato',
  'esBigDeal', 'bigDeal', 'cad_bigdeal',
  'owner', 'ownerName', 'ejecutivo', 'vendedor', 'responsable',
  'status', 'estatus', 'statusReason', 'motivo', 'statuscode', 'statusCode', 'stateCode',
  'createdFrom', 'createdTo', 'estimatedCloseFrom', 'estimatedCloseTo',
  'avance', 'porcentajeAvance', 'closeprobability',
  'proyecto', 'projectName', 'name',
  'metric', 'groupBy', 'detail', 'period', 'dateBasis'
]);

function hasManualOverride(body) {
  return Object.keys(body).some((key) => MANUAL_OVERRIDE_KEYS.has(key));
}

function parseBoolean(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = normalizeText(value).trim();
  if (['true', 'si', 'sí', 'yes', '1'].includes(normalized)) {
    return true;
  }
  if (['false', 'no', '0'].includes(normalized)) {
    return false;
  }

  return null;
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function isCalendarDateValid(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validateDateFilter(label, value) {
  if (value === undefined || value === null || value === '') {
    return;
  }

  const raw = String(value).trim();
  const match = ISO_DATE_PATTERN.exec(raw);
  if (!match) {
    throw new Error(`El filtro "${label}" tiene un formato de fecha invalido: "${raw}". Usa formato ISO 8601, por ejemplo 2026-06-30T23:59:59Z.`);
  }

  const [, year, month, day] = match;
  if (!isCalendarDateValid(Number(year), Number(month), Number(day))) {
    throw new Error(`El filtro "${label}" tiene una fecha que no existe en el calendario: "${raw}". Revisa el dia y el mes.`);
  }
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
      probabilityTotal: 0,
      utilidadEstimada: 0,
      costoHardwareEstimado: 0,
      equipos: 0
    };

    current.count += 1;
    current.estimatedValue += getNumber(row.estimatedvalue);
    current.probabilityTotal += getNumber(row.closeprobability);
    current.utilidadEstimada += getNumber(row.cad_utilidad);
    current.costoHardwareEstimado += getNumber(row.new_costohardware);
    current.equipos += getNumber(row.cad_cantidad1);
    groups.set(key, current);
  }

  return [...groups.values()].map((item) => ({
    key: item.key,
    count: item.count,
    estimatedValue: Number(item.estimatedValue.toFixed(2)),
    averageProbability: item.count ? Number((item.probabilityTotal / item.count).toFixed(2)) : 0,
    utilidadEstimada: Number(item.utilidadEstimada.toFixed(2)),
    costoHardwareEstimado: Number(item.costoHardwareEstimado.toFixed(2)),
    margenUtilidad: item.estimatedValue ? Number(((item.utilidadEstimada / item.estimatedValue) * 100).toFixed(2)) : 0,
    equipos: item.equipos
  }));
}

function buildOpportunityItem(row) {
  return {
    name: getFormatted(row, 'name'),
    owner: getFormatted(row, '_ownerid_value'),
    area: getFormatted(row, '_cad_un_value'),
    customer: getFormatted(row, '_customerid_value'),
    estimatedValue: getNumber(row.estimatedvalue),
    closeProbability: getNumber(row.closeprobability),
    estimatedCloseDate: getFormatted(row, 'estimatedclosedate'),
    statusReason: getFormatted(row, 'statuscode'),
    createdOn: getFormatted(row, 'createdon'),
    utilidadEstimada: getNumber(row.cad_utilidad),
    costoHardwareEstimado: getNumber(row.new_costohardware),
    equipos: getNumber(row.cad_cantidad1),
    tipoProyecto: getFormatted(row, '_cad_tipodeproyecto_value'),
    tipoContrato: getFormatted(row, 'cr2bd_tipodecontrato'),
    esBigDeal: getFormatted(row, 'cad_bigdeal')
  };
}

// Ordenado por valor estimado desc: en un tablero de forecast, las oportunidades mas grandes son las mas relevantes.
function buildOpportunityItems(rows, limit) {
  return [...rows]
    .sort((a, b) => getNumber(b.estimatedvalue) - getNumber(a.estimatedvalue))
    .slice(0, limit)
    .map(buildOpportunityItem);
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
  const currentYear = new Date().getUTCFullYear();

  return [
    'Eres un analizador de preguntas para un dashboard de oportunidades de CRM Dataverse.',
    'Tu tarea es convertir la pregunta del usuario a JSON valido.',
    'No respondas la pregunta final, solo clasifica la intencion.',
    'Campos disponibles:',
    '- oportunidades: opportunity',
    '- fechas: por default el periodo se interpreta sobre la fecha de CIERRE ESTIMADA (estimatedclosedate), igual que el reporte de forecast. Usa dateBasis=createdon SOLO si la pregunta habla explicitamente de cuando se "crearon"/"crearon" las oportunidades (fecha de creacion, no de cierre); en cualquier otro caso deja dateBasis=closedate.',
    '- estados: open=abiertas, won=ganadas, lost=perdidas, all=todas',
    '- agrupaciones: owner=responsable/vendedor, area=unidad de negocio/cad_un, customer=cliente/cuenta, tipoProyecto=tipo de proyecto, tipoContrato=tipo de contrato, none=sin agrupacion',
    '- metricas: count=cantidad, estimatedValue=venta/valor estimado, averageProbability=probabilidad promedio (% de avance), utilidadEstimada=utilidad estimada, costoHardwareEstimado=costo estimado de hardware, margenUtilidad=margen de utilidad %, equipos=numero de equipos',
    'Si la pregunta no se puede responder con esos campos, marca isAnswerable=false.',
    'El forecast por default es del ANIO Y MES EN CURSO: si la pregunta no especifica periodo (ni mes, ni anio, ni "todas"/"historico"), usa period=current_month. Solo usa period=all si el usuario pide explicitamente historico/todas las fechas/sin importar la fecha.',
    'Si pide "ultimo mes" o equivalente, usa period=last_30_days.',
    'Si pide "este mes" (mes en curso, sin anio especifico), usa period=current_month.',
    'Si pide un mes y/o anio concreto (ej. "marzo", "abril de 2026", "en junio"), usa period=specific_month y llena month (numero 1-12) y year (numero de 4 digitos; si no menciona el anio usa el actual, ' + currentYear + ', porque el forecast siempre asume el anio en curso salvo que se diga otro).',
    'Si pide un anio completo SIN mes especifico (ej. "en 2026", "durante 2025", "este anio"), usa period=specific_year y llena year (month debe quedar null).',
    'IMPORTANTE: "cerrar"/"cierre"/"cierran"/"cerraron" se refiere a la fecha de CIERRE ESTIMADA (estimatedclosedate, es decir el periodo), NO al estado de la oportunidad. "Cuantas oportunidades cierran/cerraron en 2025" es un filtro de PERIODO (period=specific_year, year=2025, state=all), NO significa que se hayan ganado. Solo pon state=won si el usuario dice explicitamente "ganadas"/"se ganaron"/"won"/"ganado".',
    'Si pide el mayor/mas/top, order=desc. Si pide menor/menos/bottom, order=asc.',
    'Extrae areas si el usuario menciona unidades de negocio especificas.',
    'statusReason: solo llenalo si el usuario menciona un motivo/estatus especifico (no solo abierta/ganada/perdida). Valores permitidos exactos: ' + describeStatusReasonOptions() + '. Si no aplica, deja statusReason en null.',
    'ownerName: si el usuario pregunta por oportunidades de una persona/ejecutivo/vendedor especifico (ej. "oportunidades de Juan Perez", "cuantas tiene Ana Lopez"), pon el nombre tal cual lo menciona. Si no menciona a nadie en particular, deja ownerName en null.',
    'tipoProyecto: si el usuario menciona un tipo/categoria de proyecto especifico (ej. "INFRA-COMPUTO", "SAI") o se refiere al segmento de DaaS/arrendamiento de equipo diciendo "SA" o "Servicios Administrados" (son la misma cosa), pon el/los valores tal cual se mencionan en un arreglo. Si el usuario dice "servicios administrados" pon literal "SA" en el arreglo (es un atajo que se resuelve por separado a sus categorias reales). Si no aplica, deja un arreglo vacio.',
    'tipoContrato: solo llenalo si el usuario menciona un tipo de contrato especifico. Valores permitidos exactos: ' + describeTipoContratoOptions() + '. Si no aplica, deja tipoContrato en null.',
    'esBigDeal: pon true/false solo si el usuario pregunta especificamente por "Big Deal". Si no aplica, deja null.',
    'avance: si el usuario menciona un porcentaje de avance especifico (ej. "con 50% de avance", "al 100%"), pon el numero (0-100). Si no aplica, deja null.',
    'proyecto: si el usuario busca oportunidades cuyo nombre de proyecto contenga cierto texto (ej. "que contengan DAAS en el nombre", "del proyecto Renati"), pon ese texto tal cual. Si no aplica, deja null.',
    'detail: pon true si el usuario quiere ver el listado/detalle de las oportunidades (palabras como "cuales", "cuales son", "listame", "muestrame", "dame el detalle"). Pon false si solo quiere una cifra, total o ranking.',
    'Responde solo JSON con esta forma:',
    '{"isAnswerable":true,"reason":"","metric":"count|estimatedValue|averageProbability|utilidadEstimada|costoHardwareEstimado|margenUtilidad|equipos","groupBy":"owner|area|customer|tipoProyecto|tipoContrato|none","state":"open|won|lost|all","period":"all|last_30_days|current_month|specific_month|specific_year","dateBasis":"closedate|createdon","month":null,"year":null,"order":"desc|asc","limit":10,"areas":[],"statusReason":null,"ownerName":null,"tipoProyecto":[],"tipoContrato":null,"esBigDeal":null,"avance":null,"proyecto":null,"detail":false}'
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
  const allowedMetrics = new Set([
    'count', 'estimatedValue', 'averageProbability',
    'utilidadEstimada', 'costoHardwareEstimado', 'margenUtilidad', 'equipos'
  ]);
  const allowedGroupBy = new Set(['owner', 'area', 'customer', 'tipoProyecto', 'tipoContrato', 'none']);
  const allowedStates = new Set(['open', 'won', 'lost', 'all']);
  const allowedPeriods = new Set(['all', 'last_30_days', 'current_month', 'specific_month', 'specific_year']);
  const allowedOrders = new Set(['desc', 'asc']);
  const allowedDateBasis = new Set(['closedate', 'createdon']);

  // El forecast por default es del mes/anio en curso: si el modelo no marco un periodo
  // reconocido, se asume current_month en vez de historico/all.
  const rawPeriod = allowedPeriods.has(intent.period) ? intent.period : 'current_month';
  const month = Number.parseInt(intent.month, 10);
  const year = Number.parseInt(intent.year, 10);
  const hasValidYear = Number.isInteger(year) && year >= 2000 && year <= 2100;
  const hasValidMonthYear = Number.isInteger(month) && month >= 1 && month <= 12 && hasValidYear;
  const period = (rawPeriod === 'specific_month' && !hasValidMonthYear) || (rawPeriod === 'specific_year' && !hasValidYear)
    ? 'all'
    : rawPeriod;

  return {
    isAnswerable: intent.isAnswerable !== false,
    reason: String(intent.reason || '').trim(),
    metric: allowedMetrics.has(intent.metric) ? intent.metric : 'count',
    groupBy: allowedGroupBy.has(intent.groupBy) ? intent.groupBy : 'none',
    state: allowedStates.has(intent.state) ? intent.state : 'all',
    period,
    // Por default el periodo se interpreta sobre fecha de CIERRE ESTIMADA (estimatedclosedate),
    // igual que el reporte de forecast de PBI. Solo si la pregunta habla explicitamente de
    // "creadas"/"se crearon" el modelo debe marcar dateBasis=createdon.
    dateBasis: allowedDateBasis.has(intent.dateBasis) ? intent.dateBasis : 'closedate',
    month: period === 'specific_month' ? month : null,
    year: period === 'specific_month' || period === 'specific_year' ? year : null,
    order: allowedOrders.has(intent.order) ? intent.order : 'desc',
    limit: Math.min(Math.max(Number.parseInt(intent.limit, 10) || 10, 1), 25),
    areas: Array.isArray(intent.areas)
      ? intent.areas.map((area) => String(area).trim()).filter(Boolean)
      : [],
    statusReason: String(intent.statusReason || '').trim() || null,
    ownerName: String(intent.ownerName || '').trim() || null,
    tipoProyecto: Array.isArray(intent.tipoProyecto)
      ? intent.tipoProyecto.map((value) => String(value).trim()).filter(Boolean)
      : (String(intent.tipoProyecto || '').trim() ? [String(intent.tipoProyecto).trim()] : []),
    tipoContrato: String(intent.tipoContrato || '').trim() || null,
    esBigDeal: typeof intent.esBigDeal === 'boolean' ? intent.esBigDeal : null,
    avance: Number.isFinite(Number(intent.avance)) && String(intent.avance ?? '').trim() !== '' ? Number(intent.avance) : null,
    proyecto: String(intent.proyecto || '').trim() || null,
    detail: intent.detail === true
  };
}

function startOfMonthUTC(year, month) {
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
}

function endOfMonthUTC(year, month) {
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
}

// dateBasis='closedate' (default, alineado al forecast de PBI) llena estimatedCloseFrom/To;
// dateBasis='createdon' (solo cuando la pregunta habla de "creadas") llena createdFrom/To.
function periodToFilter(intent) {
  const dateField = intent.dateBasis === 'createdon' ? 'created' : 'estimatedClose';
  const buildKeys = (from, to) => ({
    [`${dateField}From`]: from,
    [`${dateField}To`]: to
  });

  if (intent.period === 'last_30_days') {
    // Acotado siempre hasta "ahora": para createdon es un no-op (nada se crea a futuro),
    // para cierre estimado evita arrastrar cierres futuros indefinidamente.
    return { label: 'ultimos 30 dias', ...buildKeys(startOfLastDays(30).toISOString(), new Date().toISOString()) };
  }

  if (intent.period === 'current_month') {
    // Acotado a inicio y fin del mes en curso (no solo desde el inicio): igual razon,
    // sin el limite superior "mes actual" arrastraria tambien todos los meses futuros.
    const now = new Date();
    return {
      label: 'mes actual',
      ...buildKeys(
        startOfCurrentMonth().toISOString(),
        endOfMonthUTC(now.getUTCFullYear(), now.getUTCMonth() + 1).toISOString()
      )
    };
  }

  if (intent.period === 'specific_month') {
    return {
      label: `${MONTH_NAMES_ES[intent.month - 1]} ${intent.year}`,
      ...buildKeys(
        startOfMonthUTC(intent.year, intent.month).toISOString(),
        endOfMonthUTC(intent.year, intent.month).toISOString()
      )
    };
  }

  if (intent.period === 'specific_year') {
    return {
      label: `${intent.year}`,
      ...buildKeys(
        startOfMonthUTC(intent.year, 1).toISOString(),
        endOfMonthUTC(intent.year, 12).toISOString()
      )
    };
  }

  return { label: 'historico', ...buildKeys(null, null) };
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
    tipoProyecto: { field: '_cad_tipodeproyecto_value', label: 'tipo de proyecto' },
    tipoContrato: { field: 'cr2bd_tipodecontrato', label: 'tipo de contrato' },
    none: null
  };

  return groups[groupBy] || null;
}

function metricToLabel(metric) {
  const metrics = {
    count: { key: 'count', label: 'cantidad' },
    estimatedValue: { key: 'estimatedValue', label: 'valor estimado' },
    averageProbability: { key: 'averageProbability', label: 'probabilidad promedio' },
    utilidadEstimada: { key: 'utilidadEstimada', label: 'utilidad estimada' },
    costoHardwareEstimado: { key: 'costoHardwareEstimado', label: 'costo estimado de hardware' },
    margenUtilidad: { key: 'margenUtilidad', label: 'margen de utilidad' },
    equipos: { key: 'equipos', label: 'numero de equipos' }
  };

  return metrics[metric] || metrics.count;
}

function buildAnswer({ rows, groupBy, metric, order, state, period, ranking, ownerNames, itemsShown }) {
  const metricLabel = metric.label;
  const ownerSuffix = ownerNames ? ` de ${ownerNames}` : '';

  if (!groupBy) {
    if (rows.length === 0) {
      return `La pregunta es valida, pero no encontre oportunidades ${state.label}${ownerSuffix} que coincidan con los filtros indicados.`;
    }

    const detailSuffix = itemsShown ? ` Se muestran las ${itemsShown} de mayor valor estimado en el detalle.` : '';
    return `Encontré ${rows.length} oportunidades ${state.label}${ownerSuffix} en el periodo ${period.label}.${detailSuffix}`;
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

function buildResultText(result) {
  if (!result) {
    return 'Sin datos para mostrar.';
  }

  if (Array.isArray(result.items)) {
    if (!result.items.length) {
      return 'Sin oportunidades para mostrar.';
    }

    return result.items
      .map((item, index) => `${index + 1}. ${item.name} — $${item.estimatedValue} (${item.closeProbability}%) · ${item.owner || 'sin responsable'} · ${item.statusReason || 'sin estatus'}`)
      .join('\n');
  }

  if (Array.isArray(result.ranking)) {
    if (!result.ranking.length) {
      return 'Sin ranking disponible.';
    }

    return result.ranking
      .slice(0, 5)
      .map((item, index) => {
        const value = item.count ?? item.estimatedValue ?? item.averageProbability ?? 0;
        return `${index + 1}. ${item.key}: ${value}`;
      })
      .join('\n');
  }

  if (result.summary) {
    return [
      `Cantidad: ${result.summary.count}`,
      `Valor estimado: ${result.summary.estimatedValue}`,
      `Probabilidad promedio: ${result.summary.averageProbability}`
    ].join('\n');
  }

  return 'Sin datos para mostrar.';
}

function buildUiMessage({ answer, result, areasTomadasEnCuenta, tokensAzureFoundry }) {
  return {
    type: 'AdaptiveCard',
    version: '1.5',
    body: [
      {
        type: 'Container',
        style: 'emphasis',
        bleed: true,
        items: [
          {
            type: 'TextBlock',
            text: 'Connect Forecast',
            weight: 'Bolder',
            size: 'Large',
            wrap: true
          },
          {
            type: 'TextBlock',
            text: answer,
            wrap: true,
            spacing: 'Small'
          }
        ]
      },
      {
        type: 'TextBlock',
        text: 'Resultado',
        weight: 'Bolder',
        spacing: 'Medium',
        wrap: true
      },
      {
        type: 'TextBlock',
        text: buildResultText(result),
        wrap: true
      },
      {
        type: 'FactSet',
        spacing: 'Medium',
        facts: [
          {
            title: 'Areas',
            value: areasTomadasEnCuenta.length ? areasTomadasEnCuenta.join(', ') : 'Sin areas'
          },
          {
            title: 'Tokens',
            value: String(tokensAzureFoundry)
          }
        ]
      }
    ],
    '$schema': 'https://adaptivecards.io/schemas/adaptive-card.json'
  };
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

  async requestIntentCompletion(question, maxCompletionTokens) {
    return this.azureClient.chat.completions.create({
      model: this.azureModel,
      messages: [
        { role: 'system', content: getIntentSystemPrompt() },
        { role: 'user', content: String(question) }
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: maxCompletionTokens
    });
  }

  async analyzeQuestion(question) {
    // gpt-5-mini es un modelo de razonamiento: sus tokens de "pensamiento" tambien
    // se descuentan de max_completion_tokens, dejando a veces el content vacio.
    // Si eso pasa, se reintenta una vez con mucho mas presupuesto antes de fallar.
    let response = await this.requestIntentCompletion(question, 1500);
    let totalTokens = Number(response.usage?.total_tokens ?? 0);

    if (!String(response.choices?.[0]?.message?.content ?? '').trim()) {
      const retryResponse = await this.requestIntentCompletion(question, 3000);
      totalTokens += Number(retryResponse.usage?.total_tokens ?? 0);
      response = retryResponse;
    }

    const intent = normalizeIntent(parseJsonObject(response.choices?.[0]?.message?.content));

    return {
      intent,
      usage: { total_tokens: totalTokens }
    };
  }

  buildQuery(intent, body = {}) {
    // Modo manual: el body puede forzar el periodo/base de fecha directo, sin depender
    // de como el modelo haya interpretado el texto de la pregunta.
    const allowedPeriods = new Set(['all', 'last_30_days', 'current_month', 'specific_month', 'specific_year']);
    const allowedDateBasis = new Set(['closedate', 'createdon']);
    const effectiveIntent = {
      ...intent,
      period: allowedPeriods.has(body.period) ? body.period : intent.period,
      dateBasis: allowedDateBasis.has(body.dateBasis) ? body.dateBasis : intent.dateBasis,
      month: body.period === 'specific_month' ? Number.parseInt(body.month, 10) || intent.month : intent.month,
      year: body.period === 'specific_month' || body.period === 'specific_year'
        ? Number.parseInt(body.year, 10) || intent.year
        : intent.year
    };

    const period = periodToFilter(effectiveIntent);
    const state = stateToFilter(intent.state);
    const bodyAreas = body.areas || body.area || body.cad_un || body.cad_UN;
    const intentAreas = intent.areas?.length ? intent.areas : null;

    const ownerNames = body.owner || body.ownerName || body.ejecutivo || body.vendedor || body.responsable
      || intent.ownerName || null;

    const bodyTipoProyecto = body.tipoProyecto || body.tipoProyectos || body.projectType || body.segment;
    const intentTipoProyecto = intent.tipoProyecto?.length ? intent.tipoProyecto : null;
    const tipoProyecto = bodyTipoProyecto || intentTipoProyecto;

    // Modo manual: el body trae el filtro explicito, un valor invalido es error del usuario.
    const bodyStatusInput = body.status ?? body.estatus ?? body.statusReason ?? body.motivo
      ?? body.statuscode ?? body.statusCode;
    const bodyStatusReason = bodyStatusInput !== undefined && bodyStatusInput !== null && String(bodyStatusInput).trim() !== ''
      ? resolveStatusReasonStrict(bodyStatusInput)
      : null;
    // Modo automatico: si el modelo alucina un motivo invalido, se ignora en vez de romper la consulta.
    const intentStatusReason = !bodyStatusReason && intent.statusReason
      ? resolveStatusReasonLenient(intent.statusReason)
      : null;
    const statusReason = bodyStatusReason || intentStatusReason;

    const bodyTipoContratoInput = body.tipoContrato ?? body.contractType ?? body.cr2bd_tipodecontrato;
    const bodyTipoContrato = bodyTipoContratoInput !== undefined && bodyTipoContratoInput !== null && String(bodyTipoContratoInput).trim() !== ''
      ? resolveTipoContratoStrict(bodyTipoContratoInput)
      : null;
    const intentTipoContrato = !bodyTipoContrato && intent.tipoContrato
      ? resolveTipoContratoLenient(intent.tipoContrato)
      : null;
    const tipoContrato = bodyTipoContrato || intentTipoContrato;

    const bodyEsBigDeal = parseBoolean(body.esBigDeal ?? body.bigDeal ?? body.cad_bigdeal);
    const esBigDeal = bodyEsBigDeal !== null ? bodyEsBigDeal : intent.esBigDeal;

    // Fecha de creacion (createdon): solo se filtra si el usuario lo pide explicito en el body,
    // o si el modelo detecto dateBasis=createdon en la pregunta (ej. "se crearon en marzo").
    const createdFrom = body.createdFrom || period.createdFrom;
    const createdTo = body.createdTo || period.createdTo;
    validateDateFilter('createdFrom', createdFrom);
    validateDateFilter('createdTo', createdTo);
    if (createdFrom && createdTo && new Date(createdFrom).getTime() > new Date(createdTo).getTime()) {
      throw new Error(`El filtro de fechas es invalido: createdFrom (${createdFrom}) es posterior a createdTo (${createdTo}).`);
    }

    // Fecha de cierre estimada (estimatedclosedate): default para "periodo" inferido,
    // igual semantica que el reporte de forecast de PBI (Año/Mes cierre estimado).
    const estimatedCloseFrom = body.estimatedCloseFrom || period.estimatedCloseFrom;
    const estimatedCloseTo = body.estimatedCloseTo || period.estimatedCloseTo;
    validateDateFilter('estimatedCloseFrom', estimatedCloseFrom);
    validateDateFilter('estimatedCloseTo', estimatedCloseTo);
    if (estimatedCloseFrom && estimatedCloseTo && new Date(estimatedCloseFrom).getTime() > new Date(estimatedCloseTo).getTime()) {
      throw new Error(`El filtro de fechas es invalido: estimatedCloseFrom (${estimatedCloseFrom}) es posterior a estimatedCloseTo (${estimatedCloseTo}).`);
    }

    const effectiveState = statusReason
      ? { label: `estatus "${statusReason.label}"`, stateCode: statusReason.state }
      : state;

    // Si el body trae fechas manuales que no coinciden con el periodo inferido, el texto de respuesta debe reflejarlas.
    const effectivePeriod = (body.createdFrom || body.createdTo || body.estimatedCloseFrom || body.estimatedCloseTo)
      ? {
          label: effectiveIntent.dateBasis === 'createdon' || body.createdFrom || body.createdTo
            ? `creadas del ${createdFrom || 'inicio'} al ${createdTo || 'hoy'}`
            : `con cierre estimado del ${estimatedCloseFrom || 'inicio'} al ${estimatedCloseTo || 'hoy'}`,
          createdFrom,
          createdTo,
          estimatedCloseFrom,
          estimatedCloseTo
        }
      : period;

    return {
      query: {
        select: DEFAULT_SELECT,
        createdFrom,
        createdTo,
        estimatedCloseFrom,
        estimatedCloseTo,
        stateCode: body.stateCode ?? statusReason?.state ?? state.stateCode ?? undefined,
        statuscode: statusReason?.value,
        areas: bodyAreas || intentAreas,
        ownerNames,
        tipoProyecto,
        tipoContrato: tipoContrato?.value,
        esBigDeal,
        avance: body.avance ?? body.porcentajeAvance ?? body.closeprobability ?? intent.avance ?? undefined,
        name: body.proyecto ?? body.projectName ?? body.name ?? intent.proyecto ?? undefined,
        maxRows: body.maxRows
      },
      period: effectivePeriod,
      state: effectiveState,
      statusReason,
      tipoContrato,
      esBigDeal,
      ownerNames
    };
  }

  async ask({ question, ...body }) {
    if (!question || !String(question).trim()) {
      throw new Error('Falta question en el body.');
    }

    const { intent, usage } = await this.analyzeQuestion(question);
    const tokensAzureFoundry = buildAzureFoundryTokenUsage(usage);

    // Si el texto es ambiguo pero el body trae filtros explicitos (modo manual),
    // el body gana: no se rechaza la consulta solo porque la pregunta en si no bastaba.
    if (!intent.isAnswerable && !hasManualOverride(body)) {
      return {
        answer: intent.reason || 'No puedo responder esa pregunta con la informacion disponible de oportunidades.',
        result: null,
        areasTomadasEnCuenta: [],
        tokensAzureFoundry
      };
    }

    const groupBy = groupByToField(body.groupBy || intent.groupBy);
    const metric = metricToLabel(body.metric || intent.metric);
    const order = intent.order;
    const { query, period, state, ownerNames } = this.buildQuery(intent, body);
    const maxRows = Math.min(Number(body.maxRows) || 5000, 10000);
    const filteredRows = await this.dataverseService.getAllOpportunities(query, { maxRows });
    const summary = aggregate(filteredRows, null)[0] || {
      count: 0,
      estimatedValue: 0,
      averageProbability: 0,
      utilidadEstimada: 0,
      costoHardwareEstimado: 0,
      margenUtilidad: 0,
      equipos: 0
    };
    const ranking = groupBy
      ? aggregate(filteredRows, groupBy)
        .sort((a, b) => {
          const diff = a[metric.key] - b[metric.key];
          return order === 'asc' ? diff : -diff;
        })
        .slice(0, Number(body.limit) || 10)
      : [];

    // Detalle: lista de oportunidades individuales (no solo el agregado), pedido explicitamente via body.detail o inferido del prompt ("cuales son...").
    const wantsDetail = body.detail === true || body.detail === 'true'
      ? true
      : body.detail === false || body.detail === 'false'
        ? false
        : intent.detail;
    const detailLimit = Math.min(Math.max(Number.parseInt(body.itemsLimit, 10) || 20, 1), 50);
    const items = wantsDetail ? buildOpportunityItems(filteredRows, detailLimit) : null;

    const result = {
      ...(groupBy
        ? { ranking }
        : {
            summary: {
              count: summary.count,
              estimatedValue: Number(summary.estimatedValue.toFixed(2)),
              averageProbability: summary.averageProbability,
              utilidadEstimada: summary.utilidadEstimada,
              costoHardwareEstimado: summary.costoHardwareEstimado,
              margenUtilidad: summary.margenUtilidad,
              equipos: summary.equipos
            }
          }),
      ...(items ? { items, itemsTotal: filteredRows.length } : {})
    };

    const response = {
      answer: buildAnswer({
        rows: filteredRows,
        groupBy,
        ownerNames,
        itemsShown: items?.length,
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

    if (body.includeCard === true) {
      response.uiMessage = buildUiMessage(response);
    }

    return response;
  }
}
