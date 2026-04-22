import { acquireTokenObo } from "../lib/msalObo.js";
import {
	buildSettings,
	getCopilotScope,
	buildCopilotClient,
} from "../lib/copilotClient.js";

export async function copilotSendActivity({
	userAccessToken,
	conversationId,
	activity,
	agentName,
}) {
	const settings = buildSettings(agentName);
	const copilotScope = getCopilotScope(settings);

	const obo = await acquireTokenObo(userAccessToken, [copilotScope]);
	if (!obo?.accessToken) throw new Error("obo_failed");

	const client = buildCopilotClient(settings, obo.accessToken);

	const convId = conversationId || client?.conversationId;
	if (!convId) throw new Error("missing_conversation_id");

	const activities = await client.sendActivity(activity, convId);
	
	// LOG: Ver estructura completa de sendActivity

	return { conversationId: convId, activities };
}

