import {
  ConnectionSettings,
  CopilotStudioClient,
} from "@microsoft/agents-copilotstudio-client";

/**
 * Construye la URL completa del agente basándose en el nombre
 * @param {string} agentName - Nombre del agente (ejemplo: "aria", "ventas", "soporte")
 * @returns {string} URL completa del agente
 */
export function buildAgentUrl(agentName) {
  const baseUrl = process.env.COPILOT_BASE_URL;
  const apiVersion = process.env.COPILOT_API_VERSION || "2022-03-01-preview";
  const defaultAgent = process.env.COPILOT_DEFAULT_AGENT || "aria";
  
  // Si no se proporciona nombre de agente, usar el por defecto
  const agent = agentName || defaultAgent;
  
  // Construir la URL completa
  return `${baseUrl}/cr3a3_${agent}/conversations?api-version=${apiVersion}`;
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