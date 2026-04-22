import "dotenv/config";

const baseUrl = (
  process.env.COPILOT_BACKEND_BASE_URL ||
  process.env.OPERACIONES_BACKEND_BASE_URL ||
  `http://localhost:${process.env.PORT || 3000}`
).replace(/\/+$/, "");

const bearerToken =
  process.env.COPILOT_USER_BEARER_TOKEN ||
  process.env.USER_ACCESS_TOKEN ||
  "";

const apiKey =
  process.env.OPERACIONES_COPILOT_X_API_KEY ||
  process.env.API_KEY ||
  "";

const message =
  process.env.COPILOT_TEST_MESSAGE ||
  "Hola, esto es una prueba del backend. Responde con tu nombre de agente y confirma que recibiste el mensaje.";

const agents = ["aria", "orvis"];

function buildHeaders() {
  const headers = {
    "Content-Type": "application/json",
  };

  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  return headers;
}

function summarizeMessages(data) {
  const messages = Array.isArray(data?.botMessages) ? data.botMessages : [];
  if (!messages.length) return "(sin mensajes del bot)";
  return messages
    .map((item, index) => `${index + 1}. ${item.text || "[mensaje sin texto]"}`)
    .join("\n");
}

async function testAgent(agentName) {
  const url = `${baseUrl}/agente/copilot/${agentName}/chat`;
  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({ text: message }),
  });

  const rawBody = await response.text();
  let data;
  try {
    data = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    data = rawBody;
  }

  return {
    agentName,
    url,
    status: response.status,
    ok: response.ok,
    data,
  };
}

async function main() {

  if (!bearerToken) {
    console.error(
      [
        "Falta el token de usuario.",
        "Define COPILOT_USER_BEARER_TOKEN o USER_ACCESS_TOKEN con un access token Entra ID",
        "para el audience del backend y con el scope access_as_user.",
      ].join(" ")
    );
    process.exitCode = 1;
    return;
  }

  for (const agentName of agents) {

    try {
      const result = await testAgent(agentName);

      if (!result.ok) {
        continue;
      }

    } catch (error) {
      console.error(`Error probando ${agentName}: ${error.message}`);
    }
  }
}

main();
