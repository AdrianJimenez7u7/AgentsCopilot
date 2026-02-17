import { acquireTokenObo } from "../lib/msalObo.js";
import {
  buildSettings,
  getCopilotScope,
  buildCopilotClient,
} from "../lib/copilotClient.js";

// Convierte activities a “mensajes” simples si te sirve (opcional)
function extractBotMessages(activities) {
  if (!Array.isArray(activities)) return [];
  return activities
    .filter((a) => a?.type === "message" && a?.from?.role !== "user")
    .map((a) => ({ text: a.text, attachments: a.attachments || [] }));
}

// startConversationAsync puede devolver Activity o Activity[]
// y a veces solo trae "typing" sin conversation.id.
// Esta función intenta obtener conversation.id de las activities.
function extractConversationIdFromActivities(acts) {
  if (!acts) return "";

  const arr = Array.isArray(acts) ? acts : [acts];
  for (const a of arr) {
    const id = a?.conversation?.id;
    if (id) return id;
  }
  return "";
}

export async function copilotChat({
  userAccessToken,
  conversationId,
  text,
  user,
  agentName,
}) {
  const settings = buildSettings(agentName);
  const copilotScope = getCopilotScope(settings);

  // (opcional) debug del scope derivado por el SDK
  // console.log("Derived Copilot scope:", copilotScope);

  // 1) OBO: token para Copilot Studio / Power Platform
  const obo = await acquireTokenObo(userAccessToken, [copilotScope]);
  if (!obo?.accessToken) throw new Error("obo_failed");

  // 2) Cliente Copilot Studio
  const client = buildCopilotClient(settings, obo.accessToken);

  // 3) Crear conversación si no existe
  let convId = conversationId || "";

  if (!convId) {
    const startActs = await client.startConversationAsync(true);
    
    // LOG: Ver estructura completa de startConversationAsync
    console.log('\n=== SDK startConversationAsync Response ===');
    console.log(JSON.stringify(startActs, null, 2));
    console.log('===========================================\n');

    // 3a) intenta tomarlo de activities (si vino)
    convId = extractConversationIdFromActivities(startActs);

    // 3b) si no vino (caso típico: solo "typing"), el SDK lo guarda internamente
    if (!convId) {
      convId = client?.conversationId || client?.["conversationId"] || "";
    }

    // (opcional) debug para confirmar
    // console.log("Conversation ID resolved:", convId);

    if (!convId) {
      throw new Error(
        "conversation_create_failed: no conversationId from activities nor header"
      );
    }
  }

  // 4) Enviar pregunta y recibir activities
  const activities = await client.askQuestionAsync(text, convId);
  
  // LOG: Ver estructura completa de askQuestionAsync
  console.log('\n=== SDK askQuestionAsync Response ===');
  console.log('ConversationId:', convId);
  console.log('Activities:', JSON.stringify(activities, null, 2));
  console.log('======================================\n');

  return {
    conversationId: convId,
    activities,
    botMessages: extractBotMessages(activities),
  };
}