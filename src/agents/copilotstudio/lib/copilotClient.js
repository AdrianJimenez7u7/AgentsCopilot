import {
  ConnectionSettings,
  CopilotStudioClient,
} from "@microsoft/agents-copilotstudio-client";

function resolveAgentPath(agentName) {
  const defaultAgent = process.env.COPILOT_DEFAULT_AGENT || "aria";
  const legacyPrefix = process.env.COPILOT_AGENT_PREFIX || "cr3a3_";
  const agent = String(agentName || defaultAgent).trim();

  // Compatibilidad:
  // - "aria" => "cr3a3_aria"
  // - "cr3a3_aria" => "cr3a3_aria"
  // - "otroPrefijo_agente" => se usa tal cual
  if (!agent) return `${legacyPrefix}${defaultAgent}`;
  if (agent.includes("_")) return agent;
  return `${legacyPrefix}${agent}`;
}

/**
 * Construye la URL completa del agente basándose en el identificador de ruta.
 * Acepta tanto nombres cortos heredados ("aria") como rutas completas
 * de agente ("cr3a3_aria" o cualquier otro prefijo requerido).
 * @param {string} agentName - Nombre corto o identificador completo del agente
 * @returns {string} URL completa del agente
 */
export function buildAgentUrl(agentName) {
  const baseUrl = process.env.COPILOT_BASE_URL;
  const apiVersion = process.env.COPILOT_API_VERSION || "2022-03-01-preview";
  const agentPath = resolveAgentPath(agentName);
  
  // Construir la URL completa
  return `${baseUrl}/${agentPath}/conversations?api-version=${apiVersion}`;
}

export function buildSettings(agentName) {
  const directConnectUrl = buildAgentUrl(agentName);
  
  return new ConnectionSettings({
    directConnectUrl,
  });
}

export function getCopilotScope(settings) {
  // Deriva el scope correcto desde el directConnectUrl
  return CopilotStudioClient.scopeFromSettings(settings);
}

export function buildCopilotClient(settings, accessToken) {
  return new CopilotStudioClient(settings, accessToken);
}