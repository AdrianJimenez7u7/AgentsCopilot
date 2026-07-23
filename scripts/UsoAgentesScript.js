import 'dotenv/config';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import ExcelJS from 'exceljs';

const DEFAULT_TENANT_ID = '267e7400-d5af-4805-bce9-1e4247c0c3a7';
const DEFAULT_CLIENT_ID = '6840a6b2-7154-4c5d-8081-003edd0da715';
const DEFAULT_M365_PERIOD = 'D30';
const DEFAULT_ENVIRONMENTS = [
  {
    name: 'COMPUCAD',
    baseUrl: 'https://ccad.api.crm.dynamics.com',
  },
  {
    name: 'Upgrade',
    id: 'Default-267e7400-d5af-4805-bce9-1e4247c0c3a7',
    organizationId: '4a9bfa4c-efed-48ec-845e-31ac63af7d4a',
    baseUrl: 'https://orgf61000bc.api.crm.dynamics.com',
  },
];

function requireEnv(value, name) {
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

function getConfig() {
  const tenantId = process.env.AZURE_TENANT_ID || DEFAULT_TENANT_ID;
  const clientId = process.env.DATAVERSE_CLIENT_ID || DEFAULT_CLIENT_ID;
  const clientSecret = requireEnv(process.env.DYNAMIC_SECRET, 'DYNAMIC_SECRET');
  const graphClientId = process.env.GRAPH_CLIENT_ID || process.env.AZURE_BACKEND_CLIENT_ID || clientId;
  const graphClientSecret = process.env.GRAPH_CLIENT_SECRET || process.env.AZURE_BACKEND_CLIENT_SECRET;
  const m365Period = process.env.M365_COPILOT_PERIOD || DEFAULT_M365_PERIOD;
  const singleBaseUrl = process.env.DATAVERSE_BASE_URL;
  const singleEnvironmentName = process.env.DATAVERSE_ENVIRONMENT_NAME;

  // Compatibilidad: si se definen variables legacy, ejecuta solo ese entorno.
  const environments = singleBaseUrl
    ? [{ name: singleEnvironmentName || 'CUSTOM', baseUrl: singleBaseUrl }]
    : DEFAULT_ENVIRONMENTS;

  return {
    tenantId,
    clientId,
    clientSecret,
    graphClientId,
    graphClientSecret,
    m365Period,
    environments,
  };
}

async function getAccessToken({ tenantId, clientId, clientSecret, scopeBaseUrl }) {
  const scope = `${scopeBaseUrl}/.default`;
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  const tokenParams = new URLSearchParams();
  tokenParams.append('client_id', clientId);
  tokenParams.append('scope', scope);
  tokenParams.append('client_secret', clientSecret);
  tokenParams.append('grant_type', 'client_credentials');

  const tokenResponse = await fetch(tokenUrl, {
    method: 'POST',
    body: tokenParams,
  });

  if (!tokenResponse.ok) {
    throw new Error(`No se pudo obtener token: ${await tokenResponse.text()}`);
  }

  const body = await tokenResponse.json();
  return body.access_token;
}

async function fetchConversationTranscripts(dataverseBaseUrl, accessToken) {
  const all = [];

  let nextUrl = `${dataverseBaseUrl}/api/data/v9.2/conversationtranscripts` +
    '?$select=conversationtranscriptid,createdon,content,_bot_conversationtranscriptid_value,_createdby_value' +
    '&$orderby=createdon desc';

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'odata.include-annotations="*"',
      },
    });

    if (!response.ok) {
      throw new Error(`Error consultando conversationtranscripts: ${await response.text()}`);
    }

    const json = await response.json();
    const pageItems = Array.isArray(json.value) ? json.value : [];
    all.push(...pageItems);

    nextUrl = json['@odata.nextLink'] || null;
  }

  return all;
}

async function fetchSystemUsers(dataverseBaseUrl, accessToken) {
  const all = [];

  let nextUrl = `${dataverseBaseUrl}/api/data/v9.2/systemusers` +
    '?$select=systemuserid,azureactivedirectoryobjectid,internalemailaddress,fullname' +
    '&$filter=internalemailaddress ne null';

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'odata.include-annotations="*"',
      },
    });

    if (!response.ok) {
      throw new Error(`Error consultando systemusers: ${await response.text()}`);
    }

    const json = await response.json();
    const pageItems = Array.isArray(json.value) ? json.value : [];
    all.push(...pageItems);

    nextUrl = json['@odata.nextLink'] || null;
  }

  return all;
}

async function fetchBots(dataverseBaseUrl, accessToken) {
  const all = [];

  let nextUrl = `${dataverseBaseUrl}/api/data/v9.2/bots` +
    '?$select=botid,name,schemaname,runtimeprovider';

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'odata.include-annotations="*"',
      },
    });

    if (!response.ok) {
      throw new Error(`Error consultando bots: ${await response.text()}`);
    }

    const json = await response.json();
    const pageItems = Array.isArray(json.value) ? json.value : [];
    all.push(...pageItems);

    nextUrl = json['@odata.nextLink'] || null;
  }

  return all;
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  values.push(current);
  return values;
}

function parseCsvRows(csvText) {
  const lines = String(csvText || '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || '';
    });
    rows.push(row);
  }

  return rows;
}

function getFirstNonEmptyValue(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
}

function summarizeM365UsageByApp(usageRows) {
  const appColumns = [
    {
      app: 'Copilot Chat',
      keys: ['Copilot Chat Last Activity Date', 'copilotChatLastActivityDate'],
    },
    {
      app: 'Microsoft Teams Copilot',
      keys: ['Microsoft Teams Copilot Last Activity Date', 'microsoftTeamsCopilotLastActivityDate'],
    },
    {
      app: 'Word Copilot',
      keys: ['Word Copilot Last Activity Date', 'wordCopilotLastActivityDate'],
    },
    {
      app: 'Excel Copilot',
      keys: ['Excel Copilot Last Activity Date', 'excelCopilotLastActivityDate'],
    },
    {
      app: 'PowerPoint Copilot',
      keys: ['PowerPoint Copilot Last Activity Date', 'powerPointCopilotLastActivityDate'],
    },
    {
      app: 'Outlook Copilot',
      keys: ['Outlook Copilot Last Activity Date', 'outlookCopilotLastActivityDate'],
    },
    {
      app: 'OneNote Copilot',
      keys: ['OneNote Copilot Last Activity Date', 'oneNoteCopilotLastActivityDate'],
    },
    {
      app: 'Loop Copilot',
      keys: ['Loop Copilot Last Activity Date', 'loopCopilotLastActivityDate'],
    },
  ];

  const summary = appColumns.map((item) => {
    let activeUsers = 0;
    for (const row of usageRows) {
      const value = getFirstNonEmptyValue(row, item.keys);
      if (value) activeUsers += 1;
    }

    return {
      app: item.app,
      usuarios_activos: activeUsers,
    };
  });

  return summary;
}

async function fetchGraphApplications(accessToken) {
  const allApps = [];
  let nextUrl = 'https://graph.microsoft.com/v1.0/applications?$select=id,appId,displayName,tags,createdDateTime';

  while (nextUrl) {
    const response = await fetch(nextUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Error consultando applications en Graph: ${await response.text()}`);
    }

    const data = await response.json();
    const items = Array.isArray(data.value) ? data.value : [];
    allApps.push(...items);
    nextUrl = data['@odata.nextLink'] || null;
  }

  return allApps;
}

async function fetchM365CopilotUsageCsv(accessToken, period) {
  const normalizedPeriod = ['D7', 'D30', 'D90', 'D180', 'ALL'].includes(period)
    ? period
    : DEFAULT_M365_PERIOD;

  const urls = [
    `https://graph.microsoft.com/beta/reports/getMicrosoft365CopilotUsageUserDetail(period='${normalizedPeriod}')?$format=text/csv`,
    `https://graph.microsoft.com/beta/copilot/reports/getMicrosoft365CopilotUsageUserDetail(period='${normalizedPeriod}')?$format=text/csv`,
  ];

  let lastError = '';

  for (const reportUrl of urls) {
    const response = await fetch(reportUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (response.ok) {
      return response.text();
    }

    lastError = await response.text();
  }

  throw new Error(`Error consultando reporte M365 Copilot User Detail: ${lastError}`);
}

function selectPossibleCopilotApps(applications) {
  return applications.filter((app) => {
    const name = String(app.displayName || '').toLowerCase();
    const tags = Array.isArray(app.tags) ? app.tags.map((t) => String(t).toLowerCase()) : [];
    return name.includes('copilot') || name.includes('agent') || tags.includes('m365copilot');
  });
}

function normalizeLookupKey(value) {
  return String(value || '').trim().toLowerCase();
}

function buildUserEmailLookup(systemUsers) {
  const lookup = new Map();

  for (const user of systemUsers) {
    const email = user.internalemailaddress || null;
    const displayName = user.fullname || null;
    const aadObjectId = normalizeLookupKey(user.azureactivedirectoryobjectid);
    const systemUserId = normalizeLookupKey(user.systemuserid);

    if (aadObjectId) {
      lookup.set(aadObjectId, { email, displayName });
    }
    if (systemUserId) {
      lookup.set(systemUserId, { email, displayName });
    }
  }

  return lookup;
}

function buildBotLookup(bots) {
  const lookup = new Map();

  for (const bot of bots) {
    const botId = normalizeLookupKey(bot.botid);
    if (!botId) continue;

    const botName = bot.name || bot.schemaname || `Bot(${bot.botid})`;
    const logicalName = bot.schemaname || null;
    const runtimeProvider = bot['runtimeprovider@OData.Community.Display.V1.FormattedValue']
      || bot.runtimeprovider
      || bot.RuntimeProvider
      || null;

    lookup.set(botId, {
      botName,
      logicalName,
      runtimeProvider,
    });
  }

  return lookup;
}

function detectSourceType(agentName, agentId, runtimeProvider) {
  if (!agentId || agentId === 'sin-bot-id') return 'Sin agente';

  const provider = String(runtimeProvider || '').toLowerCase();
  if (provider) {
    if (provider.includes('copilot studio')) {
      return 'Copilot Studio (Dataverse)';
    }
    if (provider.includes('microsoft 365') || provider.includes('copilot 365') || provider.includes('m365')) {
      return 'Copilot 365';
    }
    return `RuntimeProvider: ${runtimeProvider}`;
  }

  const name = (agentName || '').toLowerCase();
  if (name.startsWith('cr') || name.includes('copilot') || name.includes('studio')) {
    return 'Copilot Studio (Dataverse)';
  }

  return 'Otro/No identificado';
}

function extractEndUser(item) {
  let contentObj = null;

  try {
    contentObj = item?.content ? JSON.parse(item.content) : null;
  } catch {
    contentObj = null;
  }

  const activities = Array.isArray(contentObj?.activities) ? contentObj.activities : [];
  const userActivity = activities.find((a) => {
    if (!a?.from) return false;
    return a.from.role === 1 || a.from.role === 'user';
  });

  if (!userActivity?.from) {
    return {
      endUserId: 'sin-usuario-final-id',
      endUserName: 'Sin usuario final',
    };
  }

  const from = userActivity.from;
  const endUserId = from.aadObjectId || from.id || 'sin-usuario-final-id';
  const endUserName = from.name || from.id || 'Sin usuario final';

  return { endUserId, endUserName };
}

function countMessages(item) {
  let contentObj = null;

  try {
    contentObj = item?.content ? JSON.parse(item.content) : null;
  } catch {
    contentObj = null;
  }

  const activities = Array.isArray(contentObj?.activities) ? contentObj.activities : [];
  return activities.filter((a) => a?.type === 'message').length;
}

function extractPlanStepFinishedEvents(item) {
  let contentObj = null;

  try {
    contentObj = item?.content ? JSON.parse(item.content) : null;
  } catch {
    contentObj = null;
  }

  const activities = Array.isArray(contentObj?.activities) ? contentObj.activities : [];
  return activities
    .filter((a) => a?.type === 'event' && a?.name === 'DynamicPlanStepFinished')
    .map((a) => ({
      taskDialogId: a?.value?.taskDialogId || 'sin-accion',
      displayedCost: typeof a?.value?.displayedCost === 'number' ? a.value.displayedCost : 0,
      state: a?.value?.state || 'sin-estado',
    }));
}

function sumCredits(stepEvents) {
  return stepEvents.reduce((acc, step) => acc + (step.displayedCost || 0), 0);
}

function aggregateUsage(transcripts, environmentName, userEmailLookup, botLookup, cutoff30d) {
  const usageByAgent = new Map();

  for (const item of transcripts) {
    const agentId = item._bot_conversationtranscriptid_value || 'sin-bot-id';
    const agentKey = normalizeLookupKey(agentId);
    const formattedName = item['_bot_conversationtranscriptid_value@OData.Community.Display.V1.FormattedValue'];
    const botInfoFromLookup = botLookup.get(normalizeLookupKey(agentId));
    const agentName = botInfoFromLookup?.botName || formattedName || `Agente(${agentId})`;
    const logicalName = botInfoFromLookup?.logicalName || null;
    const runtimeProvider = botInfoFromLookup?.runtimeProvider || null;
    const sourceType = detectSourceType(agentName, agentId, runtimeProvider);
    const createdOn = item.createdon ? new Date(item.createdon) : null;
    const messageCount = countMessages(item);
    const planSteps = extractPlanStepFinishedEvents(item);
    const stepCredits = sumCredits(planSteps);
    const isLast30d = Boolean(createdOn && !Number.isNaN(createdOn.getTime()) && createdOn >= cutoff30d);
    const creatorId = item._createdby_value || 'sin-creador-id';
    const creatorName = item['_createdby_value@OData.Community.Display.V1.FormattedValue'] || 'Sin creador';
    const { endUserId, endUserName } = extractEndUser(item);
    const normalizedEndUserId = normalizeLookupKey(endUserId);
    const userFromLookup = userEmailLookup.get(normalizedEndUserId);
    const fallbackEmail = String(endUserId || '').includes('@') ? String(endUserId) : null;
    const endUserEmail = userFromLookup?.email || fallbackEmail;
    const resolvedEndUserName = userFromLookup?.displayName || endUserName;

    if (!usageByAgent.has(agentKey)) {
      usageByAgent.set(agentKey, {
        environmentName,
        agentId,
        agentName,
        logicalName,
        runtimeProvider,
        sourceType,
        messages: 0,
        sessions: 0,
        firstSeen: null,
        lastSeen: null,
        creditosTotal: 0,
        creditos30d: 0,
        creatorsMap: new Map(),
        endUsersMap: new Map(),
        actionsMap: new Map(),
      });
    }

    const current = usageByAgent.get(agentKey);
    current.messages += messageCount;
    current.sessions += 1;
    current.creditosTotal += stepCredits;
    if (isLast30d) current.creditos30d += stepCredits;

    for (const step of planSteps) {
      const actionCurrent = current.actionsMap.get(step.taskDialogId) || {
        taskDialogId: step.taskDialogId,
        invocacionesTotal: 0,
        creditosTotal: 0,
        invocaciones30d: 0,
        creditos30d: 0,
      };
      actionCurrent.invocacionesTotal += 1;
      actionCurrent.creditosTotal += step.displayedCost;
      if (isLast30d) {
        actionCurrent.invocaciones30d += 1;
        actionCurrent.creditos30d += step.displayedCost;
      }
      current.actionsMap.set(step.taskDialogId, actionCurrent);
    }

    const creatorCurrent = current.creatorsMap.get(creatorId) || { creatorName, sessions: 0 };
    creatorCurrent.sessions += 1;
    current.creatorsMap.set(creatorId, creatorCurrent);

    const endUserCurrent = current.endUsersMap.get(endUserId) || {
      endUserName: resolvedEndUserName,
      endUserEmail,
      sessions: 0,
      creditosTotal: 0,
      creditos30d: 0,
    };

    if (!endUserCurrent.endUserEmail && endUserEmail) {
      endUserCurrent.endUserEmail = endUserEmail;
    }
    if ((!endUserCurrent.endUserName || endUserCurrent.endUserName === 'Sin usuario final') && resolvedEndUserName) {
      endUserCurrent.endUserName = resolvedEndUserName;
    }

    endUserCurrent.sessions += 1;
    endUserCurrent.creditosTotal += stepCredits;
    if (isLast30d) endUserCurrent.creditos30d += stepCredits;
    current.endUsersMap.set(endUserId, endUserCurrent);

    if (createdOn && !Number.isNaN(createdOn.getTime())) {
      if (!current.firstSeen || createdOn < current.firstSeen) {
        current.firstSeen = createdOn;
      }
      if (!current.lastSeen || createdOn > current.lastSeen) {
        current.lastSeen = createdOn;
      }
    }
  }

  // Asegura que todos los agentes del catálogo aparezcan, aunque no tengan uso.
  for (const [normalizedBotId, botName] of botLookup.entries()) {
    const botInfo = botName;
    if (usageByAgent.has(normalizedBotId)) {
      continue;
    }

    usageByAgent.set(normalizedBotId, {
      environmentName,
      agentId: normalizedBotId,
      agentName: botInfo.botName,
      logicalName: botInfo.logicalName,
      runtimeProvider: botInfo.runtimeProvider,
      sourceType: detectSourceType(botInfo.botName, normalizedBotId, botInfo.runtimeProvider),
      messages: 0,
      sessions: 0,
      firstSeen: null,
      lastSeen: null,
      creditosTotal: 0,
      creditos30d: 0,
      creatorsMap: new Map(),
      endUsersMap: new Map(),
      actionsMap: new Map(),
    });
  }

  return Array.from(usageByAgent.values());
}

function buildExcelRows(usageRows) {
  return usageRows.map((row) => ({
    correos_usuarios_finales: row.endUsersMap
      ? Array.from(row.endUsersMap.values())
        .map((u) => (u.endUserEmail || '').trim().toLowerCase())
        .filter((email) => email.length > 0)
        .filter((email, idx, arr) => arr.indexOf(email) === idx)
        .join('; ')
      : '',
    nombre: row.agentName || '',
    nombre_logico: row.logicalName || '',
    entorno: row.environmentName || '',
    mensajes: row.messages || 0,
    sesiones: row.sessions || 0,
    fecha_inicio: row.firstSeen ? row.firstSeen.toISOString() : '',
    fecha_fin: row.lastSeen ? row.lastSeen.toISOString() : '',
    usuarios_finales: row.endUsersMap ? row.endUsersMap.size : 0,
    creditos_totales: row.creditosTotal || 0,
    creditos_30d: row.creditos30d || 0,
  }));
}

function buildActionCreditRows(usageRows) {
  const rows = [];

  for (const row of usageRows) {
    if (!row.actionsMap) continue;
    for (const action of row.actionsMap.values()) {
      rows.push({
        entorno: row.environmentName || '',
        agente: row.agentName || '',
        accion: action.taskDialogId,
        invocaciones_totales: action.invocacionesTotal,
        creditos_totales: action.creditosTotal,
        invocaciones_30d: action.invocaciones30d,
        creditos_30d: action.creditos30d,
      });
    }
  }

  return rows.sort((a, b) => b.creditos_totales - a.creditos_totales);
}

function buildEndUserCreditRows(usageRows) {
  const rows = [];

  for (const row of usageRows) {
    if (!row.endUsersMap) continue;
    for (const data of row.endUsersMap.values()) {
      rows.push({
        entorno: row.environmentName || '',
        agente: row.agentName || '',
        usuario: data.endUserName || '',
        correo: data.endUserEmail || '',
        sesiones: data.sessions,
        creditos_totales: data.creditosTotal || 0,
        creditos_30d: data.creditos30d || 0,
      });
    }
  }

  return rows.sort((a, b) => b.creditos_totales - a.creditos_totales);
}

async function exportToExcel(rows, graphData = null, creditData = null) {
  const outputDir = path.join(process.cwd(), 'output');
  await mkdir(outputDir, { recursive: true });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('UsoAgentes');

  sheet.columns = [
    { header: 'nombre', key: 'nombre', width: 40 },
    { header: 'nombre logico', key: 'nombre_logico', width: 35 },
    { header: 'entorno', key: 'entorno', width: 20 },
    { header: 'mensajes', key: 'mensajes', width: 14 },
    { header: 'sesiones', key: 'sesiones', width: 14 },
    { header: 'fecha inicio', key: 'fecha_inicio', width: 28 },
    { header: 'fecha fin', key: 'fecha_fin', width: 28 },
    { header: 'usuarios finales', key: 'usuarios_finales', width: 18 },
    { header: 'creditos totales', key: 'creditos_totales', width: 16 },
    { header: 'creditos 30 dias', key: 'creditos_30d', width: 16 },
    { header: 'correos usuarios finales', key: 'correos_usuarios_finales', width: 60 },
  ];

  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };

  if (creditData?.actionRows?.length) {
    const actionSheet = workbook.addWorksheet('Creditos_por_Accion');
    actionSheet.columns = [
      { header: 'entorno', key: 'entorno', width: 15 },
      { header: 'agente', key: 'agente', width: 30 },
      { header: 'accion', key: 'accion', width: 60 },
      { header: 'invocaciones totales', key: 'invocaciones_totales', width: 20 },
      { header: 'creditos totales', key: 'creditos_totales', width: 16 },
      { header: 'invocaciones 30 dias', key: 'invocaciones_30d', width: 20 },
      { header: 'creditos 30 dias', key: 'creditos_30d', width: 16 },
    ];
    actionSheet.addRows(creditData.actionRows);
    actionSheet.getRow(1).font = { bold: true };
  }

  if (creditData?.endUserRows?.length) {
    const endUserSheet = workbook.addWorksheet('Creditos_por_Usuario');
    endUserSheet.columns = [
      { header: 'entorno', key: 'entorno', width: 15 },
      { header: 'agente', key: 'agente', width: 30 },
      { header: 'usuario', key: 'usuario', width: 30 },
      { header: 'correo', key: 'correo', width: 35 },
      { header: 'sesiones', key: 'sesiones', width: 12 },
      { header: 'creditos totales', key: 'creditos_totales', width: 16 },
      { header: 'creditos 30 dias', key: 'creditos_30d', width: 16 },
    ];
    endUserSheet.addRows(creditData.endUserRows);
    endUserSheet.getRow(1).font = { bold: true };
  }

  if (graphData?.apps?.length) {
    const appsSheet = workbook.addWorksheet('M365_Apps');
    appsSheet.columns = [
      { header: 'displayName', key: 'displayName', width: 45 },
      { header: 'appId', key: 'appId', width: 40 },
      { header: 'createdDateTime', key: 'createdDateTime', width: 28 },
      { header: 'tags', key: 'tags', width: 60 },
    ];

    appsSheet.addRows(
      graphData.apps.map((app) => ({
        displayName: app.displayName || '',
        appId: app.appId || '',
        createdDateTime: app.createdDateTime || '',
        tags: Array.isArray(app.tags) ? app.tags.join('; ') : '',
      }))
    );
    appsSheet.getRow(1).font = { bold: true };
  }

  if (graphData?.usageSummary?.length) {
    const summarySheet = workbook.addWorksheet('M365_Resumen');
    summarySheet.columns = [
      { header: 'app', key: 'app', width: 40 },
      { header: 'usuarios activos', key: 'usuarios_activos', width: 20 },
    ];
    summarySheet.addRows(graphData.usageSummary);
    summarySheet.getRow(1).font = { bold: true };
  }

  if (graphData?.usageRows?.length) {
    const usageSheet = workbook.addWorksheet('M365_Usage');
    const headers = Object.keys(graphData.usageRows[0]);
    usageSheet.columns = headers.map((header) => ({
      header,
      key: header,
      width: 30,
    }));
    usageSheet.addRows(graphData.usageRows);
    usageSheet.getRow(1).font = { bold: true };
  }

  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const outputPath = path.join(outputDir, `uso_agentes_${stamp}.xlsx`);

  await workbook.xlsx.writeFile(outputPath);
  return outputPath;
}

function printReport(usageRows, totalSessions, environmentName, bots) {
  const envRows = usageRows.filter((row) => row.environmentName === environmentName);
  const totalEnvSessions = envRows.reduce((acc, row) => acc + row.sessions, 0);

  const sortedByName = [...usageRows].sort((a, b) =>
    a.agentName.localeCompare(b.agentName, 'es', { sensitivity: 'base' })
  );

  const sortedByUsage = [...usageRows].sort((a, b) => b.sessions - a.sessions);

  const usageBySource = new Map();
  for (const row of usageRows) {
    const current = usageBySource.get(row.sourceType) || 0;
    usageBySource.set(row.sourceType, current + row.sessions);
  }
  const sourceRows = Array.from(usageBySource.entries()).sort((a, b) => b[1] - a[1]);

  const sortedBots = [...bots].sort((a, b) => {
    const aName = a.name || a.schemaname || '';
    const bName = b.name || b.schemaname || '';
    return aName.localeCompare(bName, 'es', { sensitivity: 'base' });
  });
  if (sortedBots.length === 0) {
  } else {
    sortedBots.forEach((bot, index) => {
      const botName = bot.name || bot.schemaname || 'Sin nombre';
      const runtimeProvider = bot['runtimeprovider@OData.Community.Display.V1.FormattedValue']
        || bot.runtimeprovider
        || bot.RuntimeProvider
        || 'Sin RuntimeProvider';
    });
  }
  sortedByName.forEach((row, index) => {
  });
  sortedByUsage.forEach((row, index) => {
    const pct = totalSessions > 0 ? ((row.sessions / totalSessions) * 100).toFixed(2) : '0.00';
    const firstSeen = row.firstSeen ? row.firstSeen.toISOString() : '-';
    const lastSeen = row.lastSeen ? row.lastSeen.toISOString() : '-';
  });
  sortedByUsage.forEach((row, index) => {
    const creators = Array.from(row.creatorsMap.entries())
      .map(([creatorId, data]) => ({ creatorId, creatorName: data.creatorName, sessions: data.sessions }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 5);

    const creatorsText = creators.length > 0
      ? creators.map((c) => `${c.creatorName} (${c.creatorId})=${c.sessions}`).join(' | ')
      : 'Sin creadores detectados';
  });
  sortedByUsage.forEach((row, index) => {
    const endUsers = Array.from(row.endUsersMap.entries())
      .map(([endUserId, data]) => ({
        endUserId,
        endUserName: data.endUserName,
        endUserEmail: data.endUserEmail,
        sessions: data.sessions,
      }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 5);

    const endUsersText = endUsers.length > 0
      ? endUsers.map((u) => `${u.endUserName} <${u.endUserEmail || 'sin-email'}> (${u.endUserId})=${u.sessions}`).join(' | ')
      : 'Sin usuarios finales detectados';
  });
  sourceRows.forEach(([sourceType, sessions], index) => {
    const pct = totalSessions > 0 ? ((sessions / totalSessions) * 100).toFixed(2) : '0.00';
  });
}

async function main() {
  const config = getConfig();
  const allUsageRows = [];
  let graphData = null;
  const cutoff30d = new Date();
  cutoff30d.setDate(cutoff30d.getDate() - 30);

  for (const environment of config.environments) {
    if (environment.id) {
    }
    if (environment.organizationId) {
    }
    const token = await getAccessToken({
      tenantId: config.tenantId,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      scopeBaseUrl: environment.baseUrl,
    });
    const transcripts = await fetchConversationTranscripts(environment.baseUrl, token);
    const systemUsers = await fetchSystemUsers(environment.baseUrl, token);
    const userEmailLookup = buildUserEmailLookup(systemUsers);

    let bots = [];
    let botLookup = new Map();
    try {
      bots = await fetchBots(environment.baseUrl, token);
      botLookup = buildBotLookup(bots);
    } catch (error) {
      console.warn(`No se pudo consultar tabla bots en ${environment.name}: ${error.message}`);
    }

    const usageRows = aggregateUsage(transcripts, environment.name, userEmailLookup, botLookup, cutoff30d);
    allUsageRows.push(...usageRows);
    printReport(usageRows, transcripts.length, environment.name, bots);
  }
  try {
    const graphToken = await getAccessToken({
      tenantId: config.tenantId,
      clientId: config.graphClientId,
      clientSecret: requireEnv(config.graphClientSecret, 'GRAPH_CLIENT_SECRET o DYNAMIC_SECRET'),
      scopeBaseUrl: 'https://graph.microsoft.com',
    });

    const allApps = await fetchGraphApplications(graphToken);
    const possibleApps = selectPossibleCopilotApps(allApps);
    const csvText = await fetchM365CopilotUsageCsv(graphToken, config.m365Period);
    const usageRows = parseCsvRows(csvText);
    const usageSummary = summarizeM365UsageByApp(usageRows);

    graphData = {
      apps: possibleApps,
      usageRows,
      usageSummary,
    };
  } catch (error) {
    console.warn(`No se pudo obtener datos de Graph: ${error.message}`);
    console.warn('Revisa permisos Graph de aplicación, por ejemplo Application.Read.All y Reports.Read.All con admin consent.');
  }

  const excelRows = buildExcelRows(allUsageRows);
  const creditData = {
    actionRows: buildActionCreditRows(allUsageRows),
    endUserRows: buildEndUserCreditRows(allUsageRows),
  };
  const excelPath = await exportToExcel(excelRows, graphData, creditData);
}

main().catch((error) => {
  console.error('\nError ejecutando UsoAgentesScript:', error.message);
  process.exitCode = 1;
});
