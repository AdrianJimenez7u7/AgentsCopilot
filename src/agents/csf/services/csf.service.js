import DocumentIntelligence, {
  getLongRunningPoller,
  isUnexpected
} from '@azure-rest/ai-document-intelligence';
import { AzureOpenAI } from 'openai';
import { logger } from '../../../shared/utils/logger.js';

const DEFAULT_VALUE = 'N/A';

const OUTPUT_KEYS = [
  'CodigoPostal',
  'Correo',
  'EntreCalle',
  'EstatusPadron',
  'FechaExpedicion',
  'FechaUltimoCambio',
  'LugarExpedicion',
  'NombreColonia',
  'NombreEntidad',
  'NombreLocalidad',
  'NombreMunicipio',
  'NombreVialidad',
  'Numero',
  'NumeroExterior',
  'NumeroInterior',
  'Regimen',
  'RegimenCapital',
  'TelFijo',
  'TipoVialidad',
  'YCalle',
  'fechaInicioOperaciones',
  'nombreComercial',
  'razonSocial',
  'rfc'
];

const FIELD_ALIASES = {
  CodigoPostal: ['CodigoPostal'],
  Correo: ['Correo', 'Email', 'CorreoElectronico'],
  EntreCalle: ['EntreCalle'],
  EstatusPadron: ['EstatusPadron', 'estatusPadron'],
  FechaExpedicion: ['FechaExpedicion'],
  FechaUltimoCambio: ['FechaUltimoCambio', 'fechaUltimoCambio'],
  LugarExpedicion: ['LugarExpedicion'],
  NombreColonia: ['NombreColonia'],
  NombreEntidad: ['NombreEntidad', 'EntidadFederativa', 'NombreEntidadFederativa'],
  NombreLocalidad: ['NombreLocalidad'],
  NombreMunicipio: ['NombreMunicipio', 'Municipio', 'DemarcacionTerritorial'],
  NombreVialidad: ['NombreVialidad'],
  Numero: ['Numero', 'Telefono', 'TelefonoMovil', 'Celular'],
  NumeroExterior: ['NumeroExterior'],
  NumeroInterior: ['NumeroInterior'],
  Regimen: ['Regimen'],
  RegimenCapital: ['RegimenCapital'],
  TelFijo: ['TelFijo', 'TelefonoFijo'],
  TipoVialidad: ['TipoVialidad'],
  YCalle: ['YCalle'],
  fechaInicioOperaciones: ['fechaInicioOperaciones', 'FechaInicioOperaciones'],
  nombreComercial: ['nombreComercial', 'NombreComercial'],
  razonSocial: ['razonSocial', 'RazonSocial'],
  rfc: ['rfc', 'RFC']
};

function normalizeKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
}

function fixMojibake(value) {
  const text = String(value ?? '');
  if (!/[ÃÂ]/.test(text)) {
    return text;
  }

  try {
    return Buffer.from(text, 'latin1').toString('utf8');
  } catch {
    return text;
  }
}

function removeDiacritics(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function cleanupSpaces(value) {
  return String(value ?? '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .replace(/\s+,/g, ',')
    .trim();
}

function cleanupFieldValue(value, key) {
  if (value === null || value === undefined) {
    return DEFAULT_VALUE;
  }

  const compact = cleanupSpaces(value)
    .replace(/\n+/g, ' ')
    .replace(/^[:\s-]+/, '')
    .replace(/[:\s-]+$/, '')
    .trim();

  if (!compact) {
    return DEFAULT_VALUE;
  }

  if (key === 'Correo') {
    return compact;
  }

  if (key === 'Numero' || key === 'TelFijo') {
    return compact;
  }

  if (key === 'NumeroInterior') {
    const cleanedInterior = compact
      .replace(/^(NUMERO\s+)?INTERIOR[:\s-]*/i, '')
      .replace(/^(NO\.?|NUM)\s*INTERIOR[:\s-]*/i, '')
      .trim();
    return cleanedInterior ? removeDiacritics(cleanedInterior).toUpperCase() : DEFAULT_VALUE;
  }

  const normalized = removeDiacritics(compact).toUpperCase();

  if (key === 'LugarExpedicion') {
    return normalized.replace(/\s*,\s*/g, ', ').replace(/[,\s]+$/, '').trim();
  }

  return normalized;
}

function getFieldRawValue(field) {
  if (!field || typeof field !== 'object') {
    return '';
  }

  return field.valueString ?? field.value ?? field.content ?? '';
}

function buildFieldMap(fields = {}) {
  return new Map(
    Object.entries(fields).map(([key, value]) => [normalizeKey(key), value])
  );
}

function isValidForKey(key, value) {
  const normalized = cleanupFieldValue(value, key);

  if (normalized === DEFAULT_VALUE) {
    return false;
  }

  switch (key) {
    case 'CodigoPostal':
      return /^\d{5}$/.test(normalized);
    case 'rfc':
      return /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/.test(normalized);
    case 'EstatusPadron':
      return /^(ACTIVO|SUSPENDIDO|CANCELADO|REANUDADO|BAJA|PENDIENTE)(\b|$)/.test(normalized);
    case 'FechaExpedicion':
    case 'FechaUltimoCambio':
    case 'fechaInicioOperaciones':
      return /^(\d{1,2}\s+DE\s+[A-Z]+\s+DE\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{4})$/.test(normalized);
    case 'Numero':
    case 'TelFijo':
      return normalized.replace(/\D/g, '').length >= 8;
    case 'Regimen':
      return normalized.length >= 3;
    default:
      return true;
  }
}

function sanitizeSourceData(source = {}) {
  const sanitized = {};

  for (const key of OUTPUT_KEYS) {
    const value = source?.[key];
    sanitized[key] = isValidForKey(key, value) ? value : '';
  }

  return sanitized;
}

function extractFromFields(fieldMap, aliases = []) {
  for (const alias of aliases) {
    const field = fieldMap.get(normalizeKey(alias));
    const confidence = Number(field?.confidence ?? 1);
    if (confidence > 0 && confidence < 0.8) {
      continue;
    }

    const value = getFieldRawValue(field);
    if (String(value ?? '').trim()) {
      return value;
    }
  }

  return '';
}

function getNormalizedContent(content) {
  return cleanupSpaces(fixMojibake(content));
}

function getAsciiUpperText(content) {
  return removeDiacritics(getNormalizedContent(content)).toUpperCase();
}

function pickRegex(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]?.trim()) {
      return cleanupSpaces(match[1]);
    }
  }

  return '';
}

function parseLugarYFecha(content) {
  const text = getNormalizedContent(content);
  const lines = text
    .split('\n')
    .map((line) => cleanupSpaces(line))
    .filter(Boolean);

  const markerIndex = lines.findIndex((line) =>
    normalizeKey(line).includes(normalizeKey('Lugar y Fecha de Emision'))
  );

  if (markerIndex === -1) {
    return {};
  }

  const candidate = [lines[markerIndex + 1], lines[markerIndex + 2]]
    .filter(Boolean)
    .join(' ');
  const match = candidate.match(/^(.*?)\s+A\s+(.+)$/i);

  if (!match) {
    return {};
  }

  const lugar = cleanupSpaces(match[1]);
  const fecha = cleanupSpaces(match[2])
    .replace(/\s+[A-Z0-9&Ñ]{12,13}\s+.*$/i, '')
    .trim();

  return { lugar, fecha };
}

function parseLabeledPhones(content) {
  const text = getNormalizedContent(content);
  const mobileMatch = text.match(/TELEFONO\s+MOVIL[:\s]*\n?\s*([+\d()\s-]{8,})/i);
  const fixedMatch = text.match(/(?:TELEFONO\s+FIJO|TEL(?:EFONO)?\s+FIJO)[:\s]*\n?\s*([+\d()\s-]{8,})/i);

  return {
    Numero: cleanupSpaces(mobileMatch?.[1] ?? ''),
    TelFijo: cleanupSpaces(fixedMatch?.[1] ?? '')
  };
}

function extractByRules(content) {
  const text = getAsciiUpperText(content);
  const { lugar, fecha } = parseLugarYFecha(content);
  const phones = parseLabeledPhones(content);

  return {
    CodigoPostal: pickRegex(text, [
      /CODIGO POSTAL[:\s]*([A-Z0-9-]+)/,
      /C\.?P\.?[:\s]*([A-Z0-9-]{5,})/
    ]),
    Correo: pickRegex(text, [
      /CORREO(?: ELECTRONICO)?[:\s]+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/
    ]),
    EntreCalle: pickRegex(text, [
      /ENTRE CALLE[:\s]+(.+?)(?=\s+Y CALLE[:\s])/,
      /ENTRECALLE[:\s]+(.+?)(?=\s+YCALLE[:\s])/
    ]),
    EstatusPadron: pickRegex(text, [
      /ESTATUS EN EL PADRON[:\s]+(.+?)(?=\s+FECHA DE ULTIMO CAMBIO DE ESTADO[:\s])/,
      /ESTATUS PADRON[:\s]+(.+?)(?=\s+FECHA)/
    ]),
    FechaExpedicion: fecha ?? '',
    FechaUltimoCambio: pickRegex(text, [
      /FECHA DE ULTIMO CAMBIO DE ESTADO[:\s]+(.+?)(?=\s+DATOS DEL DOMICILIO REGISTRADO)/,
      /FECHA ULTIMO CAMBIO[:\s]+(.+?)(?=\s+DATOS DEL DOMICILIO)/
    ]),
    LugarExpedicion: lugar ?? '',
    NombreColonia: pickRegex(text, [
      /NOMBRE DE LA COLONIA[:\s]+(.+?)(?=\s+NOMBRE DE LA LOCALIDAD[:\s])/,
      /COLONIA[:\s]+(.+?)(?=\s+NOMBRE DE LA LOCALIDAD[:\s])/
    ]),
    NombreEntidad: pickRegex(text, [
      /NOMBRE DE LA ENTIDAD FEDERATIVA[:\s]+(.+?)(?=\s+ENTRE CALLE[:\s])/,
      /ENTIDAD FEDERATIVA[:\s]+(.+?)(?=\s+ENTRE CALLE[:\s])/
    ]),
    NombreLocalidad: pickRegex(text, [
      /NOMBRE DE LA LOCALIDAD[:\s]+(.+?)(?=\s+NOMBRE DEL MUNICIPIO(?: O DEMARCACION TERRITORIAL)?[:\s])/,
      /LOCALIDAD[:\s]+(.+?)(?=\s+NOMBRE DEL MUNICIPIO)/
    ]),
    NombreMunicipio: pickRegex(text, [
      /NOMBRE DEL MUNICIPIO(?: O DEMARCACION TERRITORIAL)?[:\s]+(.+?)(?=\s+NOMBRE DE LA ENTIDAD FEDERATIVA[:\s])/,
      /MUNICIPIO(?: O DEMARCACION TERRITORIAL)?[:\s]+(.+?)(?=\s+NOMBRE DE LA ENTIDAD FEDERATIVA[:\s])/
    ]),
    NombreVialidad: pickRegex(text, [
      /NOMBRE DE VIALIDAD[:\s]+(.+?)(?=\s+NUMERO EXTERIOR[:\s])/,
      /NOMBRE DE LA VIALIDAD[:\s]+(.+?)(?=\s+NUMERO EXTERIOR[:\s])/
    ]),
    Numero: phones.Numero,
    NumeroExterior: pickRegex(text, [
      /NUMERO EXTERIOR[:\s]+(.+?)(?=\s+NUMERO INTERIOR[:\s])/,
      /NO\.?\s*EXTERIOR[:\s]+(.+?)(?=\s+NUMERO INTERIOR[:\s])/
    ]),
    NumeroInterior: pickRegex(text, [
      /NUMERO INTERIOR[:\s]+(.+?)(?=\s+NOMBRE DE LA COLONIA[:\s])/,
      /NO\.?\s*INTERIOR[:\s]+(.+?)(?=\s+NOMBRE DE LA COLONIA[:\s])/
    ]),
    Regimen: pickRegex(text, [
      /REGIMENES[:\s]+REGIMEN\s+FECHA INICIO\s+FECHA FIN\s+(.+?)(?=\s+\d{1,2}\/\d{1,2}\/\d{4}|\s+OBLIGACIONES[:\s])/,
      /REGIMEN[:\s]+(.+?)(?=\s+\d{1,2}\/\d{1,2}\/\d{4}|\s+OBLIGACIONES[:\s])/
    ]),
    RegimenCapital: pickRegex(text, [
      /REGIMEN CAPITAL[:\s]+(.+?)(?=\s+NOMBRE COMERCIAL[:\s])/,
      /REGIMEN CAPITAL[:\s]+(.+?)(?=\s+FECHA INICIO DE OPERACIONES[:\s])/,
      /REGIMEN CAPITAL[:\s]+(.+?)(?=\s+DATOS DE UBICACION[:\s])/
    ]),
    TelFijo: phones.TelFijo,
    TipoVialidad: pickRegex(text, [
      /TIPO DE VIALIDAD[:\s]+(.+?)(?=\s+NOMBRE DE VIALIDAD[:\s])/,
      /TIPO VIALIDAD[:\s]+(.+?)(?=\s+NOMBRE DE VIALIDAD[:\s])/
    ]),
    YCalle: pickRegex(text, [
      /Y CALLE[:\s]+(.+?)(?=\s+(?:ACTIVIDADES ECONOMICAS|CARACTERISTICAS DEL DOMICILIO)[:\s])/,
      /YCALLE[:\s]+(.+?)(?=\s+(?:ACTIVIDADES ECONOMICAS|CARACTERISTICAS DEL DOMICILIO)[:\s])/
    ]),
    fechaInicioOperaciones: pickRegex(text, [
      /FECHA INICIO DE OPERACIONES[:\s]+(.+?)(?=\s+ESTATUS EN EL PADRON[:\s])/,
      /FECHA DE INICIO DE OPERACIONES[:\s]+(.+?)(?=\s+ESTATUS EN EL PADRON[:\s])/
    ]),
    nombreComercial: pickRegex(text, [
      /NOMBRE COMERCIAL[:\s]+(.+?)(?=\s+FECHA INICIO DE OPERACIONES[:\s])/,
      /NOMBRE COMERCIAL[:\s]+(.+?)(?=\s+DATOS DE UBICACION[:\s])/,
      /NOMBRE COMERCIAL[:\s]+(.+?)(?=\s+ESTATUS EN EL PADRON[:\s])/
    ]),
    razonSocial: pickRegex(text, [
      /DENOMINACION\/RAZON SOCIAL[:\s]+(.+?)(?=\s+REGIMEN CAPITAL[:\s])/,
      /NOMBRE,\s*DENOMINACION O RAZON SOCIAL\s+(.+?)(?=\s+IDCIF[:\s])/,
      /DENOMINACION O RAZON SOCIAL[:\s]+(.+?)(?=\s+REGIMEN CAPITAL[:\s])/
    ]),
    rfc: pickRegex(text, [
      /\bRFC[:\s]+([A-Z0-9&Ñ]{12,13})\b/,
      /\bREGISTRO FEDERAL DE CONTRIBUYENTES\s+([A-Z0-9&Ñ]{12,13})\b/
    ])
  };
}

function mergeData(...sources) {
  const merged = CsfService.getEmptyBody();

  for (const key of OUTPUT_KEYS) {
    for (const source of sources) {
      const candidate = cleanupFieldValue(source?.[key], key);
      if (candidate !== DEFAULT_VALUE) {
        merged[key] = candidate;
        break;
      }
    }
  }

  return merged;
}

function getMissingKeys(body) {
  return OUTPUT_KEYS.filter((key) => cleanupFieldValue(body[key], key) === DEFAULT_VALUE);
}

function extractJsonObject(text) {
  const raw = String(text ?? '').trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('Unexpected end of JSON input');
    }

    return JSON.parse(raw.slice(start, end + 1));
  }
}

export class CsfService {
  constructor() {
    this.endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
    this.key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
    this.modelId = process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL_CSF_ID;

    if (!this.endpoint || !this.key || !this.modelId) {
      throw new Error(
        'Azure Document Intelligence configuration missing for CSF. ' +
        'Set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT, AZURE_DOCUMENT_INTELLIGENCE_KEY ' +
        'and AZURE_DOCUMENT_INTELLIGENCE_MODEL_CSF_ID.'
      );
    }

    this.client = DocumentIntelligence(this.endpoint, { key: this.key });
  }

  static getEmptyBody() {
    return Object.fromEntries(OUTPUT_KEYS.map((key) => [key, DEFAULT_VALUE]));
  }

  static async extraerDesdeBase64(base64Code) {
    const service = new CsfService();
    return service.extraer(base64Code);
  }

  normalizeBase64(base64Code) {
    const raw = String(base64Code ?? '').trim();
    const cleaned = raw.replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');

    if (!cleaned) {
      throw new Error('El campo base64_code no contiene datos validos.');
    }

    if (!/^[A-Za-z0-9+/=]+$/.test(cleaned)) {
      throw new Error('El campo base64_code no es un Base64 valido.');
    }

    const buffer = Buffer.from(cleaned, 'base64');

    if (!buffer.length) {
      throw new Error('No fue posible decodificar el documento Base64.');
    }

    return buffer;
  }

  async analizarDocumento(base64Code) {
    const body = this.normalizeBase64(base64Code);
    const initialResponse = await this.client
      .path('/documentModels/{modelId}:analyze', this.modelId)
      .post({
        contentType: 'application/octet-stream',
        body
      });

    if (isUnexpected(initialResponse)) {
      throw initialResponse.body.error;
    }

    const poller = getLongRunningPoller(this.client, initialResponse);
    const result = await poller.pollUntilDone();
    const analyzeResult = result.body?.analyzeResult;

    if (!analyzeResult) {
      throw new Error('No se recibio analyzeResult del servicio de Azure.');
    }

    return analyzeResult;
  }

  mapearCamposEstructurados(fields = {}) {
    const fieldMap = buildFieldMap(fields);
    const mapped = {};

    for (const key of OUTPUT_KEYS) {
      mapped[key] = extractFromFields(fieldMap, FIELD_ALIASES[key] ?? []);
    }

    return sanitizeSourceData(mapped);
  }

  hasLlmFallback() {
    return Boolean(
      process.env.AZURE_OPENAI_5_MINI_ENDPOINT &&
      process.env.AZURE_OPENAI_5_MINI_API_KEY &&
      process.env.AZURE_OPENAI_5_MINI_API_VERSION &&
      process.env.AZURE_OPENAI_5_MINI_MODEL
    );
  }

  async completarConLlm(currentBody, content) {
    const missingKeys = getMissingKeys(currentBody);

    if (!missingKeys.length || !content || !this.hasLlmFallback()) {
      return {};
    }

    const client = new AzureOpenAI({
      endpoint: process.env.AZURE_OPENAI_5_MINI_ENDPOINT,
      apiKey: process.env.AZURE_OPENAI_5_MINI_API_KEY,
      apiVersion: process.env.AZURE_OPENAI_5_MINI_API_VERSION,
      deployment: process.env.AZURE_OPENAI_5_MINI_MODEL
    });

    const prompt = `
Extrae datos fiscales del SAT.
Reglas:
- Responde solo JSON valido.
- Usa exclusivamente informacion visible en el texto.
- No inventes datos.
- Si un valor no existe con claridad, responde "N/A".
- Conserva las claves exactamente como fueron pedidas.
- No omitas ninguna de estas claves: ${OUTPUT_KEYS.join(', ')}.

Datos parciales ya extraidos:
${JSON.stringify(currentBody, null, 2)}
`;

    try {
      const response = await client.chat.completions.create({
        model: process.env.AZURE_OPENAI_5_MINI_MODEL,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: getNormalizedContent(content).slice(0, 14000) }
        ],
        response_format: { type: 'json_object' },
        max_completion_tokens: 1500
      });

      return sanitizeSourceData(
        extractJsonObject(response.choices?.[0]?.message?.content ?? '{}')
      );
    } catch (error) {
      logger.warn('No fue posible completar campos CSF con LLM fallback', {
        message: error?.message ?? String(error)
      });
      return {};
    }
  }

  async extraer(base64Code) {
    const analyzeResult = await this.analizarDocumento(base64Code);
    const document = analyzeResult.documents?.[0] ?? {};
    const structured = this.mapearCamposEstructurados(document.fields);
    const contentRules = sanitizeSourceData(extractByRules(analyzeResult.content ?? ''));

    let body = mergeData(structured, contentRules);

    if (getMissingKeys(body).length > 0) {
      const llmData = await this.completarConLlm(body, analyzeResult.content ?? '');
      body = mergeData(body, llmData);
    }

    return mergeData(body);
  }
}
