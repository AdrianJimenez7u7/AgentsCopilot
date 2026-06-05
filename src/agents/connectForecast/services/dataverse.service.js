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
  '_ownerid_value'
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
  'ownerid'
]);

const EXCLUDED_BUSINESS_UNIT_NAMES = new Set([
  'MICROSOFT',
  'COMPUCLOUD',
  'GESTION DE TALENTO',
  'ADOBE',
  'AUTODESK',
  'MENSAJERIA'
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

function isExcludedBusinessUnitName(value) {
  const normalized = normalizeBusinessUnitName(value);
  return normalized.startsWith('ERROR') || EXCLUDED_BUSINESS_UNIT_NAMES.has(normalized);
}

function parseBusinessUnitInput(value) {
  if (Array.isArray(value)) {
    return value.flatMap(parseBusinessUnitInput);
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

  buildOpportunityParams(query = {}) {
    const params = new URLSearchParams();
    const filters = [];

    params.set('$select', normalizeQueryValue(query.select) || normalizeQueryValue(query.$select) || DEFAULT_OPPORTUNITY_SELECT);
    params.set('$top', String(parseTop(normalizeQueryValue(query.top) || normalizeQueryValue(query.$top))));

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

    const ownerId = normalizeQueryValue(query.ownerId);
    if (ownerId) {
      filters.push(buildComparison('_ownerid_value', 'eq', ownerId));
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

    const businessUnitIds = parseBusinessUnitInput(query.businessUnitIds || query.businessUnitId);
    if (businessUnitIds.length) {
      const businessUnitFilters = businessUnitIds
        .filter(isGuid)
        .map((businessUnitId) => `_cad_un_value eq ${businessUnitId}`);

      if (businessUnitFilters.length) {
        filters.push(`(${businessUnitFilters.join(' or ')})`);
      }
    }

    const cleanFilters = filters.filter(Boolean);
    if (cleanFilters.length) {
      params.set('$filter', cleanFilters.join(' and '));
    }

    return params;
  }

  async getBusinessUnits({ includeExcluded = false } = {}) {
    if (this.businessUnitsCache) {
      return includeExcluded
        ? this.businessUnitsCache
        : this.businessUnitsCache.filter((unit) => !isExcludedBusinessUnitName(unit.name));
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

    return includeExcluded
      ? this.businessUnitsCache
      : this.businessUnitsCache.filter((unit) => !isExcludedBusinessUnitName(unit.name));
  }

  async resolveBusinessUnitIds(values) {
    const requestedNames = parseBusinessUnitInput(values);

    if (!requestedNames.length) {
      return [];
    }

    const excluded = requestedNames.filter(isExcludedBusinessUnitName);
    if (excluded.length) {
      throw new Error(`Areas no permitidas para este filtro: ${excluded.join(', ')}`);
    }

    const businessUnits = await this.getBusinessUnits({ includeExcluded: false });
    const byName = new Map(
      businessUnits.map((unit) => [normalizeBusinessUnitName(unit.name), unit])
    );

    const notFound = [];
    const ids = [];

    for (const requestedName of requestedNames) {
      const unit = byName.get(normalizeBusinessUnitName(requestedName));
      if (!unit) {
        notFound.push(requestedName);
        continue;
      }

      ids.push(unit.businessunitid);
    }

    if (notFound.length) {
      throw new Error(`No se encontraron areas validas en Dataverse: ${notFound.join(', ')}`);
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

    if (!businessUnitNames) {
      return input;
    }

    const businessUnitIds = await this.resolveBusinessUnitIds(businessUnitNames);

    return {
      ...input,
      businessUnitIds
    };
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
    const params = this.buildOpportunityParams({
      ...normalizedQuery,
      top: Math.min(maxRows, 500)
    });
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
          Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"'
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
