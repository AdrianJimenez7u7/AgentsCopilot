const DEFAULT_OPPORTUNITY_SELECT = [
  'opportunityid',
  'name',
  '_cad_un_value',
  'estimatedvalue',
  'estimatedclosedate',
  'closeprobability',
  'salesstage',
  'statuscode',
  'statecode',
  'createdon',
  'modifiedon',
  '_customerid_value',
  '_ownerid_value',
  'cad_utilidad',
  'cad_bigdeal',
  'cr2bd_tipodecontrato',
  '_cad_tipodeproyecto_value',
  'cad_cantidad1',
  'new_costohardware'
].join(',');

const OPPORTUNITY_FILTER_FIELDS = new Set([
  'opportunityid',
  'name',
  'estimatedvalue',
  'estimatedclosedate',
  'closeprobability',
  'salesstage',
  'statuscode',
  'statecode',
  'createdon',
  'modifiedon',
  '_customerid_value',
  '_ownerid_value',
  '_cad_un_value',
  '_customerid_value',
  '_parentaccountid_value',
  '_parentcontactid_value',
  'customerid',
  'ownerid',
  'cad_utilidad',
  'cad_bigdeal',
  'cr2bd_tipodecontrato',
  '_cad_tipodeproyecto_value',
  'cad_cantidad1',
  'new_costohardware'
]);

// "SA" / "Servicios Administrados" (linea de DaaS/arrendamiento de equipo): pagina de
// forecast filtrada por estos Tipo de Proyecto exactos. Confirmado 1:1 contra el reporte
// de PBI (conteo, venta, utilidad, # de equipos y costo de hardware coinciden exacto).
const SA_TIPO_PROYECTO_NAMES = [
  'INFRA-DaaS',
  'SA Apple',
  'Póliza SA CDH',
  'SA Gobierno',
  'SA Mov',
  'SAI',
  'SAI-BI (Big Impression)'
];

// Formas en que el negocio se refiere al segmento SA; cualquiera de estas se resuelve
// al mismo grupo de Tipo de Proyecto de arriba.
const SA_SEGMENT_ALIASES = new Set([
  'SA',
  'SERVICIOS ADMINISTRADOS',
  'SERVICIO ADMINISTRADO',
  'SOLUCIONES ADMINISTRADAS'
]);

function escapeODataString(value) {
  return String(value ?? '').replace(/'/g, "''");
}

function normalizeQueryValue(value) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function normalizeBusinessUnitName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

// Distancia de edición simple (Levenshtein) para tolerar typos al buscar por nombre
// (ej. "infraestrcutura ip" -> "INFRAESTRUCTURA IP").
function levenshteinDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const distances = Array.from({ length: rows }, (_, i) => {
    const row = new Array(cols).fill(0);
    row[0] = i;
    return row;
  });

  for (let j = 1; j < cols; j += 1) {
    distances[0][j] = j;
  }

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      distances[i][j] = Math.min(
        distances[i - 1][j] + 1,
        distances[i][j - 1] + 1,
        distances[i - 1][j - 1] + cost
      );
    }
  }

  return distances[rows - 1][cols - 1];
}

// Encuentra la mejor coincidencia difusa contra una lista de candidatos ya normalizados.
// Devuelve null si el mejor candidato no supera el umbral de similitud (25% de la longitud).
function findClosestMatch(requestedNormalized, candidates) {
  let best = null;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const distance = levenshteinDistance(requestedNormalized, candidate.normalized);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  if (!best) {
    return null;
  }

  const maxLength = Math.max(requestedNormalized.length, best.normalized.length) || 1;
  const threshold = Math.max(2, Math.ceil(maxLength * 0.25));

  return bestDistance <= threshold ? { ...best, distance: bestDistance } : null;
}

function parseListInput(value) {
  if (Array.isArray(value)) {
    return value.flatMap(parseListInput);
  }

  if (value === undefined || value === null) {
    return [];
  }

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTop(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 50;
  }

  return Math.min(parsed, 500);
}

function isGuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? ''));
}

function buildComparison(field, operator, value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const normalizedField = String(field ?? '').trim();
  if (!OPPORTUNITY_FILTER_FIELDS.has(normalizedField)) {
    return null;
  }

  const normalizedOperator = String(operator ?? 'eq').trim().toLowerCase();
  const allowedOperators = new Set(['eq', 'ne', 'gt', 'ge', 'lt', 'le']);
  if (!allowedOperators.has(normalizedOperator)) {
    return null;
  }

  if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value))) {
    return `${normalizedField} ${normalizedOperator} ${value}`;
  }

  if (isGuid(value)) {
    return `${normalizedField} ${normalizedOperator} ${value}`;
  }

  return `${normalizedField} ${normalizedOperator} '${escapeODataString(value)}'`;
}

export class ConnectForecastDataverseService {
  constructor() {
    this.tenantId = process.env.AZURE_TENANT_ID;
    this.clientId = process.env.DATAVERSE_CLIENT_ID || '6840a6b2-7154-4c5d-8081-003edd0da715';
    this.clientSecret = process.env.DATAVERSE_CLIENT_SECRET || process.env.DYNAMIC_SECRET;
    this.webApiUrl = process.env.CONNECT_FORECAST_DATAVERSE_WEB_API_URL
      || process.env.DATAVERSE_WEB_API_URL
      || 'https://ccad.api.crm.dynamics.com/api/data/v9.2';
    this.scope = `${new URL(this.webApiUrl).origin}/.default`;
    this.businessUnitsCache = null;
    this.tipoProyectosCache = null;
  }

  validateConfig() {
    const missing = [];

    if (!this.tenantId) missing.push('AZURE_TENANT_ID');
    if (!this.clientId) missing.push('DATAVERSE_CLIENT_ID');
    if (!this.clientSecret) missing.push('DATAVERSE_CLIENT_SECRET o DYNAMIC_SECRET');
    if (!this.webApiUrl) missing.push('DATAVERSE_WEB_API_URL');

    if (missing.length) {
      throw new Error(`Falta configuracion Dataverse: ${missing.join(', ')}`);
    }
  }

  async getAccessToken() {
    this.validateConfig();

    const response = await fetch(`https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: this.scope,
        grant_type: 'client_credentials'
      })
    });

    if (!response.ok) {
      throw new Error(`Error obteniendo token Dataverse: ${response.status} ${response.statusText} - ${await response.text()}`);
    }

    const data = await response.json();
    return data.access_token;
  }

  buildOpportunityParams(query = {}, { skipTop = false } = {}) {
    const params = new URLSearchParams();
    const filters = [];

    params.set('$select', normalizeQueryValue(query.select) || normalizeQueryValue(query.$select) || DEFAULT_OPPORTUNITY_SELECT);
    // Dataverse no incluye @odata.nextLink cuando se manda $top, asi que las consultas que
    // necesitan paginar todo el resultado (getAllOpportunities) deben omitirlo y controlar
    // el tamano de pagina con el header Prefer: odata.maxpagesize en su lugar.
    if (!skipTop) {
      params.set('$top', String(parseTop(normalizeQueryValue(query.top) || normalizeQueryValue(query.$top))));
    }

    const orderBy = normalizeQueryValue(query.orderby) || normalizeQueryValue(query.orderBy) || normalizeQueryValue(query.$orderby);
    if (orderBy) {
      params.set('$orderby', orderBy);
    }

    const expand = normalizeQueryValue(query.expand) || normalizeQueryValue(query.$expand);
    if (expand) {
      params.set('$expand', expand);
    }

    const skip = normalizeQueryValue(query.skip) || normalizeQueryValue(query.$skip);
    if (skip !== undefined && skip !== '') {
      params.set('$skip', String(Number.parseInt(skip, 10) || 0));
    }

    const rawFilter = normalizeQueryValue(query.filter) || normalizeQueryValue(query.$filter);
    if (rawFilter) {
      filters.push(String(rawFilter));
    }

    const name = normalizeQueryValue(query.name);
    if (name) {
      filters.push(`contains(name,'${escapeODataString(name)}')`);
    }

    const opportunityId = normalizeQueryValue(query.opportunityId);
    if (opportunityId) {
      filters.push(buildComparison('opportunityid', 'eq', opportunityId));
    }

    const customerId = normalizeQueryValue(query.customerId);
    if (customerId) {
      filters.push(buildComparison('_customerid_value', 'eq', customerId));
    }

    const statusCode = normalizeQueryValue(query.statuscode) || normalizeQueryValue(query.statusCode);
    if (statusCode !== undefined) {
      filters.push(buildComparison('statuscode', 'eq', statusCode));
    }

    const stateCode = normalizeQueryValue(query.statecode) || normalizeQueryValue(query.stateCode);
    if (stateCode !== undefined) {
      filters.push(buildComparison('statecode', 'eq', stateCode));
    }

    const createdFrom = normalizeQueryValue(query.createdFrom);
    if (createdFrom) {
      filters.push(`createdon ge ${createdFrom}`);
    }

    const createdTo = normalizeQueryValue(query.createdTo);
    if (createdTo) {
      filters.push(`createdon le ${createdTo}`);
    }

    const estimatedCloseFrom = normalizeQueryValue(query.estimatedCloseFrom);
    if (estimatedCloseFrom) {
      filters.push(`estimatedclosedate ge ${estimatedCloseFrom}`);
    }

    const estimatedCloseTo = normalizeQueryValue(query.estimatedCloseTo);
    if (estimatedCloseTo) {
      filters.push(`estimatedclosedate le ${estimatedCloseTo}`);
    }

    const minEstimatedValue = normalizeQueryValue(query.minEstimatedValue);
    if (minEstimatedValue !== undefined) {
      filters.push(buildComparison('estimatedvalue', 'ge', minEstimatedValue));
    }

    const maxEstimatedValue = normalizeQueryValue(query.maxEstimatedValue);
    if (maxEstimatedValue !== undefined) {
      filters.push(buildComparison('estimatedvalue', 'le', maxEstimatedValue));
    }

    const avance = normalizeQueryValue(query.avance) ?? normalizeQueryValue(query.closeprobability);
    if (avance !== undefined && avance !== null && avance !== '') {
      filters.push(buildComparison('closeprobability', 'eq', avance));
    }

    const minAvance = normalizeQueryValue(query.minAvance) ?? normalizeQueryValue(query.avanceMinimo);
    if (minAvance !== undefined && minAvance !== null && minAvance !== '') {
      filters.push(buildComparison('closeprobability', 'ge', minAvance));
    }

    const businessUnitIds = parseListInput(query.businessUnitIds || query.businessUnitId);
    if (businessUnitIds.length) {
      const businessUnitFilters = businessUnitIds
        .filter(isGuid)
        .map((businessUnitId) => `_cad_un_value eq ${businessUnitId}`);

      if (businessUnitFilters.length) {
        filters.push(`(${businessUnitFilters.join(' or ')})`);
      }
    }

    const ownerIds = parseListInput(query.ownerIds || query.ownerId);
    if (ownerIds.length) {
      const ownerFilters = ownerIds
        .filter(isGuid)
        .map((ownerId) => `_ownerid_value eq ${ownerId}`);

      if (ownerFilters.length) {
        filters.push(`(${ownerFilters.join(' or ')})`);
      }
    }

    const tipoProyectoIds = parseListInput(query.tipoProyectoIds || query.tipoProyectoId);
    if (tipoProyectoIds.length) {
      const tipoProyectoFilters = tipoProyectoIds
        .filter(isGuid)
        .map((tipoProyectoId) => `_cad_tipodeproyecto_value eq ${tipoProyectoId}`);

      if (tipoProyectoFilters.length) {
        filters.push(`(${tipoProyectoFilters.join(' or ')})`);
      }
    }

    const tipoContrato = normalizeQueryValue(query.tipoContrato) ?? normalizeQueryValue(query.cr2bd_tipodecontrato);
    if (tipoContrato !== undefined && tipoContrato !== null && tipoContrato !== '') {
      filters.push(buildComparison('cr2bd_tipodecontrato', 'eq', tipoContrato));
    }

    const esBigDeal = normalizeQueryValue(query.esBigDeal) ?? normalizeQueryValue(query.cad_bigdeal);
    if (esBigDeal !== undefined && esBigDeal !== null && esBigDeal !== '') {
      filters.push(`cad_bigdeal eq ${esBigDeal === true || esBigDeal === 'true' ? 'true' : 'false'}`);
    }

    const cleanFilters = filters.filter(Boolean);
    if (cleanFilters.length) {
      params.set('$filter', cleanFilters.join(' and '));
    }

    return params;
  }

  async getBusinessUnits() {
    if (this.businessUnitsCache) {
      return this.businessUnitsCache;
    }

    const token = await this.getAccessToken();
    const params = new URLSearchParams({
      '$select': 'businessunitid,name',
      '$top': '500',
      '$orderby': 'name asc'
    });

    const response = await fetch(`${this.webApiUrl}/businessunits?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0'
      }
    });

    if (!response.ok) {
      throw new Error(`Error obteniendo unidades de negocio: ${response.status} ${response.statusText} - ${await response.text()}`);
    }

    const data = await response.json();
    this.businessUnitsCache = data.value || [];

    return this.businessUnitsCache;
  }

  async resolveBusinessUnitIds(values) {
    const requestedNames = parseListInput(values);

    if (!requestedNames.length) {
      return [];
    }

    const businessUnits = await this.getBusinessUnits();
    const candidates = businessUnits.map((unit) => ({
      id: unit.businessunitid,
      name: unit.name,
      normalized: normalizeBusinessUnitName(unit.name)
    }));
    const byName = new Map(candidates.map((candidate) => [candidate.normalized, candidate]));

    const notFound = [];
    const ids = [];

    for (const requestedName of requestedNames) {
      const normalizedRequest = normalizeBusinessUnitName(requestedName);
      const exact = byName.get(normalizedRequest);

      if (exact) {
        ids.push(exact.id);
        continue;
      }

      // Sin coincidencia exacta: tolerar typos con la coincidencia mas cercana.
      const closest = findClosestMatch(normalizedRequest, candidates);
      if (closest) {
        ids.push(closest.id);
        continue;
      }

      const suggestions = [...candidates]
        .map((candidate) => ({ candidate, distance: levenshteinDistance(normalizedRequest, candidate.normalized) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3)
        .map(({ candidate }) => candidate.name);

      notFound.push(suggestions.length ? `"${requestedName}" (¿quisiste decir: ${suggestions.join(', ')}?)` : `"${requestedName}"`);
    }

    if (notFound.length) {
      throw new Error(`No se encontraron areas validas en Dataverse: ${notFound.join('; ')}`);
    }

    return [...new Set(ids)];
  }

  async getTipoProyectos() {
    if (this.tipoProyectosCache) {
      return this.tipoProyectosCache;
    }

    const token = await this.getAccessToken();
    const rows = [];
    let url = `${this.webApiUrl}/cad_tipodeproyectos?${new URLSearchParams({
      '$select': 'cad_tipodeproyectoid,cad_tipodeproyecto',
      '$orderby': 'cad_tipodeproyecto asc'
    }).toString()}`;

    while (url) {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'OData-MaxVersion': '4.0',
          'OData-Version': '4.0',
          Prefer: 'odata.maxpagesize=500'
        }
      });

      if (!response.ok) {
        throw new Error(`Error obteniendo tipos de proyecto: ${response.status} ${response.statusText} - ${await response.text()}`);
      }

      const data = await response.json();
      rows.push(...(data.value || []));
      url = data['@odata.nextLink'] || null;
    }

    this.tipoProyectosCache = rows;
    return rows;
  }

  async resolveTipoProyectoIds(values) {
    const requestedNames = parseListInput(values).flatMap((name) => {
      // Atajo de negocio: "SA" / "Servicios Administrados" agrupa la linea de
      // DaaS/arrendamiento de equipo, que en Dataverse corresponde a estos Tipo de
      // Proyecto exactos (ver SA_TIPO_PROYECTO_NAMES).
      if (SA_SEGMENT_ALIASES.has(normalizeBusinessUnitName(name))) {
        return SA_TIPO_PROYECTO_NAMES;
      }
      return [name];
    });

    if (!requestedNames.length) {
      return [];
    }

    const tipos = await this.getTipoProyectos();
    const candidates = tipos.map((tipo) => ({
      id: tipo.cad_tipodeproyectoid,
      name: tipo.cad_tipodeproyecto,
      normalized: normalizeBusinessUnitName(tipo.cad_tipodeproyecto)
    }));
    const byName = new Map(candidates.map((candidate) => [candidate.normalized, candidate]));

    const notFound = [];
    const ids = [];

    for (const requestedName of requestedNames) {
      const normalizedRequest = normalizeBusinessUnitName(requestedName);
      const exact = byName.get(normalizedRequest);

      if (exact) {
        ids.push(exact.id);
        continue;
      }

      const closest = findClosestMatch(normalizedRequest, candidates);
      if (closest) {
        ids.push(closest.id);
        continue;
      }

      notFound.push(`"${requestedName}"`);
    }

    if (notFound.length) {
      throw new Error(`No se encontraron tipos de proyecto validos en Dataverse: ${notFound.join(', ')}`);
    }

    return [...new Set(ids)];
  }

  async resolveOwnerIds(values) {
    const requestedNames = parseListInput(values);

    if (!requestedNames.length) {
      return [];
    }

    const token = await this.getAccessToken();
    const notFound = [];
    const ids = [];

    for (const requestedName of requestedNames) {
      const params = new URLSearchParams({
        '$select': 'systemuserid,fullname',
        '$filter': `contains(fullname,'${escapeODataString(requestedName)}') and isdisabled eq false`,
        '$top': '10'
      });

      const response = await fetch(`${this.webApiUrl}/systemusers?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'OData-MaxVersion': '4.0',
          'OData-Version': '4.0'
        }
      });

      if (!response.ok) {
        throw new Error(`Error buscando ejecutivo "${requestedName}": ${response.status} ${response.statusText} - ${await response.text()}`);
      }

      const data = await response.json();
      const matches = data.value || [];

      if (!matches.length) {
        notFound.push(requestedName);
        continue;
      }

      matches.forEach((match) => ids.push(match.systemuserid));
    }

    if (notFound.length) {
      throw new Error(`No se encontro ningun ejecutivo/responsable con el nombre: ${notFound.join(', ')}`);
    }

    return [...new Set(ids)];
  }

  async buildOpportunityQuery(input = {}) {
    const businessUnitNames = input.areas
      || input.area
      || input.cad_un
      || input.cad_UN
      || input.cadUn
      || input.businessUnits
      || input.businessUnitNames;

    const ownerNames = input.ownerNames || input.ownerName;

    const tipoProyectoNames = input.tipoProyecto
      || input.tipoProyectos
      || input.projectType
      || input.segment;

    let output = input;

    if (businessUnitNames) {
      const businessUnitIds = await this.resolveBusinessUnitIds(businessUnitNames);
      output = { ...output, businessUnitIds };
    }

    if (ownerNames) {
      const ownerIds = await this.resolveOwnerIds(ownerNames);
      output = { ...output, ownerIds };
    }

    if (tipoProyectoNames) {
      const tipoProyectoIds = await this.resolveTipoProyectoIds(tipoProyectoNames);
      output = { ...output, tipoProyectoIds };
    }

    return output;
  }

  async getOpportunities(query = {}) {
    const token = await this.getAccessToken();
    const normalizedQuery = await this.buildOpportunityQuery(query);
    const params = this.buildOpportunityParams(normalizedQuery);
    const response = await fetch(`${this.webApiUrl}/opportunities?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"'
      }
    });

    if (!response.ok) {
      throw new Error(`Error obteniendo oportunidades: ${response.status} ${response.statusText} - ${await response.text()}`);
    }

    return response.json();
  }

  async getAllOpportunities(query = {}, { maxRows = 5000 } = {}) {
    const token = await this.getAccessToken();
    const normalizedQuery = await this.buildOpportunityQuery(query);
    const params = this.buildOpportunityParams(normalizedQuery, { skipTop: true });
    const rows = [];
    let url = `${this.webApiUrl}/opportunities?${params.toString()}`;

    while (url && rows.length < maxRows) {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'OData-MaxVersion': '4.0',
          'OData-Version': '4.0',
          Prefer: `odata.include-annotations="OData.Community.Display.V1.FormattedValue",odata.maxpagesize=${Math.min(maxRows, 500)}`
        }
      });

      if (!response.ok) {
        throw new Error(`Error obteniendo oportunidades: ${response.status} ${response.statusText} - ${await response.text()}`);
      }

      const data = await response.json();
      rows.push(...(data.value || []));
      url = data['@odata.nextLink'] || null;
    }

    return rows.slice(0, maxRows);
  }
}
