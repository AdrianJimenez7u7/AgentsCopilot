import axios from "axios";
import { getAzureCredential } from "./azureCredential.js";

const credential = getAzureCredential();

function extractModelNameFromAssetId(assetId) {
  // Algunos recursos de Azure ML exponen el nombre funcional del modelo dentro del id.
  // Ejemplo: .../models/PD_Cobranza/versions/1
  const text = String(assetId || "");
  const match = text.match(/\/models\/([^/]+)(?:\/versions\/|$)/i);
  return match?.[1] || null;
}

function pickFriendlyModelName(model) {
  // Azure ML no siempre entrega un campo consistente para el nombre "amigable" del modelo.
  // Por eso se prueban varias ubicaciones comunes antes de caer al nombre técnico del recurso.
  const tags = model?.properties?.tags || {};
  const candidates = [
    model?.properties?.displayName,
    model?.properties?.modelName,
    model?.properties?.name,
    tags.modelName,
    tags.model_name,
    tags.registered_model_name,
    tags.registeredModelName,
    tags.azureml_model_name,
    tags["azureml.model_name"],
    tags["mlflow.registered_model_name"],
    tags["model-name"],
  ];

  for (const value of candidates) {
    const text = String(value || "").trim();
    if (text) return text;
  }

  return null;
}

async function getMgmtToken() {
  // Este token no es para invocar inferencia; sirve para consultar recursos del workspace
  // mediante Azure Management API.
  const tok = await credential.getToken(process.env.AZURE_MGMT_SCOPE || "https://management.azure.com/.default");
  return tok.token;
}

function baseMgmtUrl() {
  const sub = process.env.AZ_SUBSCRIPTION_ID;
  const rg = process.env.AZ_RESOURCE_GROUP;
  const ws = process.env.AZ_ML_WORKSPACE;
  const apiVersion = process.env.AZURE_MGMT_API_VERSION || "2025-12-01";

  return {
    sub, rg, ws, apiVersion,
    // Todas las llamadas de catálogo salen de este prefijo base del workspace AML.
    prefix: `https://management.azure.com/subscriptions/${sub}/resourceGroups/${rg}` +
            `/providers/Microsoft.MachineLearningServices/workspaces/${ws}`
  };
}

export async function getBatchEndpointDetails(endpointName) {
  const { prefix, apiVersion } = baseMgmtUrl();
  const url = `${prefix}/batchEndpoints/${encodeURIComponent(endpointName)}?api-version=${apiVersion}`;

  const token = await getMgmtToken();
  const resp = await axios.get(url, { 
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true 
  });

  if (resp.status !== 200) {
    throw new Error(`Failed to get endpoint details: ${resp.status} - ${JSON.stringify(resp.data)}`);
  }

  // Aquí se regresa el payload completo porque el detalle de endpoint suele ser útil para debug.
  return resp.data;
}

export async function listBatchEndpoints() {
  const { prefix, apiVersion } = baseMgmtUrl();
  const url = `${prefix}/batchEndpoints?api-version=${apiVersion}`;

  const token = await getMgmtToken();
  const resp = await axios.get(url, { 
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true 
  });

  if (resp.status !== 200) {
    throw new Error(`Failed to list batch endpoints: ${resp.status} - ${JSON.stringify(resp.data)}`);
  }

  const items = resp.data?.value || [];
  return items.map(e => ({
    // Se normaliza la respuesta para exponer solo los campos más útiles al frontend.
    name: e.name,
    id: e.id,
    location: e.location,
    provisioningState: e.properties?.provisioningState,
    scoringUri: e.properties?.scoringUri,
    defaults: e.properties?.defaults,
  }));
}

export async function listOnlineEndpoints() {
  const { prefix, apiVersion } = baseMgmtUrl();
  const url = `${prefix}/onlineEndpoints?api-version=${apiVersion}`;

  const token = await getMgmtToken();
  const resp = await axios.get(url, { 
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true 
  });

  if (resp.status !== 200) {
    throw new Error(`Failed to list online endpoints: ${resp.status} - ${JSON.stringify(resp.data)}`);
  }

  const items = resp.data?.value || [];
  return items.map(e => ({
    name: e.name,
    id: e.id,
    kind: e.kind,
    provisioningState: e.properties?.provisioningState,
    scoringUri: e.properties?.scoringUri,
  }));
}

export async function listBatchDeployments(endpointName) {
  const { prefix, apiVersion } = baseMgmtUrl();
  const url = `${prefix}/batchEndpoints/${encodeURIComponent(endpointName)}/deployments?api-version=${apiVersion}`;

  const token = await getMgmtToken();
  const resp = await axios.get(url, { 
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true 
  });

  if (resp.status !== 200) {
    throw new Error(`Failed to list deployments: ${resp.status} - ${JSON.stringify(resp.data)}`);
  }

  const items = resp.data?.value || [];
  return items.map(d => ({
    // `model` se deja completo porque puede traer estructura distinta según el deployment.
    name: d.name,
    provisioningState: d.properties?.provisioningState,
    description: d.properties?.description,
    model: d.properties?.model,
  }));
}

export async function listModelContainers() {
  const { prefix, apiVersion } = baseMgmtUrl();
  const url = `${prefix}/models?api-version=${apiVersion}`;

  const token = await getMgmtToken();
  const resp = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });

  const items = resp.data?.value || [];
  return items.map(m => ({
    // `name` y `resourceName` conservan el nombre técnico del recurso registrado en AML.
    name: m.name,
    resourceName: m.name,
    // `modelName` intenta resolver el nombre funcional para usarlo en endpoints como /models/:modelName/versions.
    modelName:
      pickFriendlyModelName(m) ||
      extractModelNameFromAssetId(m.id) ||
      m.name,
    description: m.properties?.description,
    tags: m.properties?.tags,
  }));
}

export async function listModelVersions(modelName) {
  const { prefix, apiVersion } = baseMgmtUrl();
  const url = `${prefix}/models/${encodeURIComponent(modelName)}/versions?api-version=${apiVersion}`;

  const token = await getMgmtToken();
  const resp = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });

  const items = resp.data?.value || [];
  return items.map(v => ({
    // Azure devuelve la versión en `name`; aquí se deja explícito como `version`.
    version: v.name,
    description: v.properties?.description,
    tags: v.properties?.tags,
    assetId: v.id,
  }));
}
