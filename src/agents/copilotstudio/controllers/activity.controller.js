import { copilotSendActivity } from "../services/activity.service.js";

export async function copilotActivityController(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const userAccessToken = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    // Obtener el nombre del agente de los parámetros de la ruta (si existe)
    const agentName = req.params.agentName || process.env.COPILOT_DEFAULT_AGENT || "aria";
    
    if (!userAccessToken) {
      return res.status(401).json({ ok: false, error: "missing_bearer_token" });
    }

    const { conversationId, activity } = req.body || {};
    if (!conversationId || !activity) {
      return res.status(400).json({ ok: false, error: "missing_conversation_or_activity" });
    }

    const result = await copilotSendActivity({ userAccessToken, conversationId, activity, agentName });
    return res.json({ ok: true, agentName, ...result });
  } catch (e) {
    next(e);
  }
}