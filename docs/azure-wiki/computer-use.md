# Modulo Computer Use (Azure Wiki)

## Objetivo
Computer Use automatiza tareas web desde un objetivo en lenguaje natural, con ejecucion por bridge (extension) o fallback headless en servidor.

## Arquitectura de ejecucion
1. Cliente envia objetivo a endpoint /run.
2. El modulo genera plan de pasos con LLM.
3. Si existe bridge activo, ejecuta comandos en navegador del usuario.
4. Si no hay bridge, ejecuta Playwright headless en servidor.
5. Evalua cada paso, reintenta y publica eventos SSE.
6. Registra telemetria de uso de modelos, acciones y notas.
7. Puede emitir datos extraidos para mostrarlos como markdown en UI.

## Modos de IA soportados
- OpenRouter (free model route).
- Azure OpenAI:
  - gpt-4.1-nano
  - gpt-5-mini

Configuracion runtime expuesta por API:
- GET /config/models
- GET /config
- PATCH /config

## Variables de entorno relevantes
OpenRouter:
- OPENROUTER_API_KEY

Azure OpenAI base:
- AZURE_API_KEY
- AZURE_OPENAI_ENDPOINT
- AZURE_OPENAI_API_VERSION
- AZURE_OPENAI_MODEL

Azure OpenAI 4.1 nano (opcionales especificas):
- AZURE_OPENAI_4_1_NANO_ENDPOINT
- AZURE_OPENAI_4_1_NANO_API_KEY
- AZURE_OPENAI_4_1_NANO_DEPLOYMENT
- AZURE_OPENAI_4_1_NANO_MODEL
- AZURE_OPENAI_4_1_NANO_API_VERSION

Azure OpenAI 5 mini (opcionales especificas):
- AZURE_OPENAI_5_MINI_ENDPOINT
- AZURE_OPENAI_5_MINI_API_KEY
- AZURE_OPENAI_5_MINI_DEPLOYMENT
- AZURE_OPENAI_5_MINI_MODEL
- AZURE_OPENAI_5_MINI_API_VERSION

Bridge:
- COMPUTER_USE_API_KEY (token opcional para handshake WS)

## Endpoints principales
Base: /agente/computer-use

- POST /run (stream SSE)
- GET /bridge/status
- POST /improve-goal
- GET /config/models
- GET /config
- PATCH /config
- GET /config/usage-summary
- GET /actions/notes

## Eventos SSE clave
- status
- plan
- step_start
- command
- step_done
- step_retry
- extracted_data
- done

## Telemetria y observabilidad
Tablas usadas:
- AI_UsesModels (uso de tokens/costo estimado)
- AI_AgentActions (acciones por paso, notas, errores)

Campos practicos:
- sessionId, runId, stepId
- actionType, status
- payloadJson
- tokensInput/tokensOutput/tokensTotal

## Riesgos operativos
- Sin bridge conectado, la ejecucion cae a headless (puede diferir del browser real del usuario).
- Selectores fragiles en paginas dinamicas generan reintentos.
- Cuotas de captura en extension requieren throttling para evitar bloqueos.

## Checklist de validacion
1. Verificar bridge conectado en /bridge/status.
2. Probar /run con objetivo simple y revisar stream SSE.
3. Confirmar cambio de provider/model con PATCH /config.
4. Revisar /config/usage-summary y /actions/notes despues de una corrida.
