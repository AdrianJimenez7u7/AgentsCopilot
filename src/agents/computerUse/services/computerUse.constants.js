export const MODEL = 'openrouter/free';

export const MAX_PARSE_RETRIES = 2;
export const MAX_ATTEMPTS = 3;
export const LLM_MAX_RETRIES = 4;
export const LLM_BASE_DELAY_MS = 1200;

export const TELEMETRY_PROJECT = 'AgentsCopilot';
export const TELEMETRY_MODULE = 'computerUse';
export const TELEMETRY_AGENT_LOGICAL = 'computer_use';
export const TELEMETRY_AGENT_PUBLIC = 'Computer Use';
export const TELEMETRY_PLATFORM = 'web';

export const PLANNER_PROMPT = `Eres un planificador experto para automatizacion web.
Tu salida debe ser util para ejecutar acciones en navegador sin ambiguedad.

Reglas:
1) Desglosa el objetivo en 3 a 10 pasos atomicos y verificables.
2) Cada descripcion debe iniciar con verbo de accion (Abrir, Buscar, Hacer clic, Escribir, Validar, etc.).
3) No inventes URLs ni datos que no esten en el objetivo.
4) Si falta informacion, agrega un paso explicito para obtenerla.
5) Prioriza seguridad: evitar acciones destructivas no solicitadas.
6) Incluye dependencias solo cuando sea necesario.

Devuelve SOLO JSON valido con este formato exacto:
{"steps":[{"id":"step1","description":"Abrir ...","priority":1,"dependencies":[]}]} `;

export const CMD_PROMPT = `Convierte un paso en UN SOLO comando de navegador.

Acciones permitidas: click, type, navigate, scroll, hover, select, wait, go_back.

Reglas importantes:
1) REGLA DE ORO DE SELECTORES: Debes USAR SIEMPRE el atributo \`cu-id\` si está presente en el elemento (Ejemplo: target: "[cu-id='42']"). Nunca inventes clases complejas si tienes el cu-id a la vista. Como segunda opcion usa (id, name, aria-label).
2) Si la tarea requiere ir a una URL explicita, usa navigate.
3) Si NO hay objetivo claro para navegar, NO inventes URL; usa wait o una accion segura en la pagina actual.
4) Para type, siempre incluye target y text.
5) Para click/hover/select, siempre incluye target.
6) Para wait, usa value en milisegundos como string.
7) Responde SOLO JSON valido sin markdown.

Formato:
{"action":"click|type|navigate|scroll|hover|select|wait|go_back","target":"css selector","text":"texto","url":"https://...","value":"..."}`;
