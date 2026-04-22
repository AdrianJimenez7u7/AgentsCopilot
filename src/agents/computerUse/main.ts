import OpenAI from "openai";
import { chromium, BrowserContext, Page } from "playwright";
import dotenv from "dotenv";
import { z } from "zod";
import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

dotenv.config();

/* ============================================================
   CONFIGURACIÓN
============================================================ */

//const MODEL = "qwen/qwen3-vl-235b-a22b-thinking";
const MODEL = "nvidia/nemotron-nano-12b-v2-vl:free";

const USER_DATA_DIR = "./user-data";
const MAX_ATTEMPTS = 3;
const MAX_PARSE_RETRIES = 2;
const LOGS_DIR = "./logs";

const DANGEROUS_ACTIONS = new Set([
    "run_command", "close_app", "file_delete", "file_write", "file_move",
]);

const client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
});

/* ============================================================
   SCHEMAS
============================================================ */

const BrowserCommandSchema = z.object({
    domain: z.literal("browser"),
    action: z.enum(["click", "type", "navigate", "scroll", "hover", "select", "wait", "go_back"]),
    target: z.string().optional(),
    text: z.string().optional(),
    url: z.string().optional(),
    value: z.string().optional(),
});

const DesktopCommandSchema = z.object({
    domain: z.literal("desktop"),
    action: z.enum([
        "run_command", "open_app", "close_app",
        "file_read", "file_write", "file_move", "file_delete",
        "list_dir", "system_info",
    ]),
    command: z.string().optional(),
    path: z.string().optional(),
    destination: z.string().optional(),
    content: z.string().optional(),
    app_name: z.string().optional(),
});

const AgentCommandSchema = z.discriminatedUnion("domain", [
    BrowserCommandSchema,
    DesktopCommandSchema,
]);

const PlanStepSchema = z.object({
    id: z.string(),
    description: z.string(),
    type: z.enum(["browser", "desktop"]),
    priority: z.number().default(1),
    dependencies: z.array(z.string()).optional(),
});

const PlanSchema = z.object({
    steps: z.array(PlanStepSchema),
});

type BrowserCommand = z.infer<typeof BrowserCommandSchema>;
type DesktopCommand = z.infer<typeof DesktopCommandSchema>;
type AgentCommand = z.infer<typeof AgentCommandSchema>;
type Plan = z.infer<typeof PlanSchema>;

type NodeStatus = "pending" | "in_progress" | "completed" | "failed";

interface GoalNode {
    id: string;
    description: string;
    type: "browser" | "desktop";
    priority: number;
    dependencies: string[];
    status: NodeStatus;
    attempts: number;
    score: number;
}

interface GoalGraph {
    goal: string;
    nodes: Record<string, GoalNode>;
}

/* ============================================================
   LOGGER
============================================================ */

let logFilePath: string;

function initLogger() {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    logFilePath = path.join(LOGS_DIR, `run-${timestamp}.jsonl`);
}

function log(level: "info" | "warn" | "error", message: string, data?: unknown) {
    const entry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...(data !== undefined && { data }),
    };

    const prefix = level === "error" ? "❌" : level === "warn" ? "⚠️" : "ℹ️";
    if (data)

    if (logFilePath) {
        fs.appendFileSync(logFilePath, JSON.stringify(entry) + "\n");
    }
}

/* ============================================================
   UTILIDADES CLI
============================================================ */

function askUser(question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise(resolve => {
        rl.question(question, (answer: string) => {
            rl.close();
            resolve(answer);
        });
    });
}

async function confirmDangerous(action: string, details: string): Promise<boolean> {
    const answer = await askUser("   ¿Permitir? (si/no) > ");
    return answer.toLowerCase() === "si";
}

/* ============================================================
   SAFE JSON PARSING
============================================================ */

function safeParseLLMJson(raw: string): unknown {
    // Strip markdown code fences
    let cleaned = raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();

    // Try direct parse first
    try {
        return JSON.parse(cleaned);
    } catch {
        // fallback: extract first JSON object
    }

    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
        throw new Error(`No se encontró JSON válido en la respuesta del LLM: ${raw.slice(0, 200)}`);
    }

    return JSON.parse(match[0]);
}

/* ============================================================
   DOM INTELIGENTE
============================================================ */

async function extractInteractiveDOM(page: Page): Promise<string> {
    return page.evaluate(() => {
        const selectors = [
            "a", "button", "input", "select", "textarea",
            "[role='button']", "[role='link']", "[role='textbox']",
            "[role='checkbox']", "[role='radio']", "[role='tab']",
            "[onclick]", "[tabindex]", "label",
        ];

        const elements = document.querySelectorAll(selectors.join(", "));
        const results: string[] = [];

        elements.forEach(el => {
            const tag = el.tagName.toLowerCase();
            const attrs: string[] = [];

            for (const attr of ["id", "name", "class", "type", "href", "placeholder", "aria-label", "role", "value"]) {
                const val = el.getAttribute(attr);
                if (val) attrs.push(`${attr}="${val.slice(0, 80)}"`);
            }

            const text = (el.textContent ?? "").trim().slice(0, 60);
            const textPart = text ? text : "";

            results.push(`<${tag} ${attrs.join(" ")}>${textPart}</${tag}>`);
        });

        return results.slice(0, 150).join("\n");
    });
}

/* ============================================================
   CONTEXTO DEL DESKTOP
============================================================ */

function getDesktopContext(): string {
    const info: string[] = [];

    info.push(`OS: ${os.platform()} ${os.release()} (${os.arch()})`);
    info.push(`Hostname: ${os.hostname()}`);
    info.push(`User: ${os.userInfo().username}`);
    info.push(`Home: ${os.homedir()}`);
    info.push(`CWD: ${process.cwd()}`);
    info.push(`RAM libre: ${Math.round(os.freemem() / 1024 / 1024)}MB / ${Math.round(os.totalmem() / 1024 / 1024)}MB`);

    try {
        const tasks = execSync("tasklist /FO CSV /NH", { encoding: "utf-8", timeout: 5000 });
        const apps = tasks.split("\n")
            .slice(0, 30)
            .map(line => line.split(",")[0]?.replace(/"/g, ""))
            .filter(Boolean);
        info.push(`\nProcesos activos (top 30): ${apps.join(", ")}`);
    } catch {
        info.push("Procesos: no disponible");
    }

    return info.join("\n");
}

/* ============================================================
   NAVEGADOR (LAZY INIT)
============================================================ */

let browserContext: BrowserContext | null = null;
let browserPage: Page | null = null;

async function getBrowserPage(): Promise<Page> {
    if (!browserPage) {
        log("info", "Inicializando navegador...");
        browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
            headless: false,
            viewport: { width: 1280, height: 800 },
            locale: "es-MX",
        });
        browserPage = await browserContext.newPage();
        log("info", "Navegador iniciado");
    }
    return browserPage;
}

async function closeBrowser() {
    if (browserContext) {
        await browserPage?.waitForTimeout(2000);
        await browserContext.close();
        browserContext = null;
        browserPage = null;
    }
}

/* ============================================================
   PLANNER
============================================================ */

const PLANNER_SYSTEM_PROMPT = `
Eres un planificador de tareas. Puedes usar DOS dominios:

1. **browser** – navegar internet, buscar, hacer click en webs, llenar formularios
2. **desktop** – ejecutar comandos del sistema, abrir/cerrar apps, crear/leer/mover/borrar archivos, listar directorios, obtener info del sistema

Clasifica cada paso según su dominio.
Devuelve SOLO JSON válido.

Formato:
{
  "steps": [
    {
      "id": "step1",
      "description": "descripcion clara del paso",
      "type": "browser | desktop",
      "priority": 1,
      "dependencies": []
    }
  ]
}
`;

async function generatePlan(goal: string): Promise<Plan> {
    for (let attempt = 0; attempt <= MAX_PARSE_RETRIES; attempt++) {
        const response = await client.chat.completions.create({
            model: MODEL,
            messages: [
                { role: "system", content: PLANNER_SYSTEM_PROMPT },
                { role: "user", content: `Objetivo: ${goal}` },
            ],
        });

        const raw = response.choices[0].message.content ?? "";

        try {
            const parsed = safeParseLLMJson(raw);
            const plan = PlanSchema.parse(parsed);
            log("info", "Plan generado exitosamente", plan);
            return plan;
        } catch (err) {
            log("warn", `Intento ${attempt + 1}/${MAX_PARSE_RETRIES + 1} de parsing falló`, {
                error: (err as Error).message,
                raw: raw.slice(0, 300),
            });
            if (attempt === MAX_PARSE_RETRIES) throw err;
        }
    }

    throw new Error("No se pudo generar el plan después de varios intentos");
}

/* ============================================================
   GOAL GRAPH
============================================================ */

function buildGraph(goal: string, plan: Plan): GoalGraph {
    const nodes: Record<string, GoalNode> = {};

    for (const step of plan.steps) {
        nodes[step.id] = {
            id: step.id,
            description: step.description,
            type: step.type,
            priority: step.priority ?? 1,
            dependencies: step.dependencies ?? [],
            status: "pending",
            attempts: 0,
            score: 0,
        };
    }

    return { goal, nodes };
}

function dependenciesSatisfied(node: GoalNode, graph: GoalGraph): boolean {
    return node.dependencies.every(dep =>
        graph.nodes[dep]?.status === "completed"
    );
}

function selectNextNode(graph: GoalGraph): GoalNode | null {
    const candidates = Object.values(graph.nodes)
        .filter(n => n.status === "pending")
        .filter(n => dependenciesSatisfied(n, graph));

    if (!candidates.length) return null;

    candidates.sort(
        (a, b) => (b.priority + b.score) - (a.priority + a.score)
    );

    return candidates[0];
}

/* ============================================================
   BROWSER EXECUTOR
============================================================ */

async function stepToBrowserCommand(page: Page, description: string): Promise<BrowserCommand> {
    const dom = await extractInteractiveDOM(page);

    for (let attempt = 0; attempt <= MAX_PARSE_RETRIES; attempt++) {
        const response = await client.chat.completions.create({
            model: MODEL,
            messages: [
                {
                    role: "system",
                    content: `
Convierte la instrucción en una acción de NAVEGADOR ejecutable.
Devuelve SOLO JSON válido.

Formato: { "domain": "browser", "action": "...", ... }
Acciones disponibles: click, type, navigate, scroll, hover, select, wait, go_back.
Campos: action (requerido), target (selector CSS), text (texto a escribir), url (para navigate), value (para select o wait en ms).
                    `,
                },
                {
                    role: "user",
                    content: `
Paso: ${description}

Elementos interactivos en la página:
${dom}
                    `,
                },
            ],
        });

        const raw = response.choices[0].message.content ?? "";

        try {
            const parsed = safeParseLLMJson(raw);
            const command = BrowserCommandSchema.parse(parsed);
            log("info", `Comando browser generado: ${command.action}`, command);
            return command;
        } catch (err) {
            log("warn", `Intento ${attempt + 1} de parsing browser falló`, {
                error: (err as Error).message,
            });
            if (attempt === MAX_PARSE_RETRIES) throw err;
        }
    }

    throw new Error("No se pudo generar el comando browser");
}

async function executeBrowserCommand(page: Page, command: BrowserCommand) {
    log("info", `Ejecutando acción browser: ${command.action}`, command);

    switch (command.action) {
        case "navigate":
            if (command.url) await page.goto(command.url);
            break;

        case "type":
            if (command.target) {
                await page.fill(command.target, command.text ?? "");
                await page.keyboard.press("Enter");
            }
            break;

        case "click":
            if (command.target) await page.click(command.target);
            break;

        case "scroll":
            await page.evaluate((delta) => window.scrollBy(0, delta),
                parseInt(command.value ?? "500", 10)
            );
            break;

        case "hover":
            if (command.target) await page.hover(command.target);
            break;

        case "select":
            if (command.target) await page.selectOption(command.target, command.value ?? "");
            break;

        case "wait":
            await page.waitForTimeout(parseInt(command.value ?? "1000", 10));
            break;

        case "go_back":
            await page.goBack();
            break;
    }
}

/* ============================================================
   DESKTOP EXECUTOR
============================================================ */

async function stepToDesktopCommand(description: string): Promise<DesktopCommand> {
    const context = getDesktopContext();

    for (let attempt = 0; attempt <= MAX_PARSE_RETRIES; attempt++) {
        const response = await client.chat.completions.create({
            model: MODEL,
            messages: [
                {
                    role: "system",
                    content: `
Convierte la instrucción en una acción de ESCRITORIO ejecutable.
Devuelve SOLO JSON válido.

Formato: { "domain": "desktop", "action": "...", ... }
Acciones disponibles:
- run_command: ejecutar un comando en la terminal. Campo: "command"
- open_app: abrir una aplicación. Campo: "app_name" (nombre o ruta del ejecutable)
- close_app: cerrar una aplicación. Campo: "app_name" (nombre del proceso)
- file_read: leer un archivo. Campo: "path"
- file_write: escribir un archivo. Campos: "path", "content"
- file_move: mover/renombrar un archivo. Campos: "path" (origen), "destination"
- file_delete: eliminar un archivo. Campo: "path"
- list_dir: listar contenido de un directorio. Campo: "path"
- system_info: obtener información del sistema. Sin campos adicionales.

Sistema operativo: Windows. Usa comandos compatibles con cmd/powershell.
                    `,
                },
                {
                    role: "user",
                    content: `
Paso: ${description}

Contexto del sistema:
${context}
                    `,
                },
            ],
        });

        const raw = response.choices[0].message.content ?? "";

        try {
            const parsed = safeParseLLMJson(raw);
            const command = DesktopCommandSchema.parse(parsed);
            log("info", `Comando desktop generado: ${command.action}`, command);
            return command;
        } catch (err) {
            log("warn", `Intento ${attempt + 1} de parsing desktop falló`, {
                error: (err as Error).message,
            });
            if (attempt === MAX_PARSE_RETRIES) throw err;
        }
    }

    throw new Error("No se pudo generar el comando desktop");
}

async function executeDesktopCommand(command: DesktopCommand): Promise<string> {
    log("info", `Ejecutando acción desktop: ${command.action}`, command);

    // Safety check
    if (DANGEROUS_ACTIONS.has(command.action)) {
        const details = command.command ?? command.path ?? command.app_name ?? "sin detalles";
        const allowed = await confirmDangerous(command.action, details);
        if (!allowed) {
            log("warn", "Acción rechazada por el usuario");
            return "ACCIÓN RECHAZADA POR EL USUARIO";
        }
    }

    try {
        switch (command.action) {
            case "run_command": {
                if (!command.command) return "Error: no se proporcionó comando";
                const output = execSync(command.command, {
                    encoding: "utf-8",
                    timeout: 30000,
                    cwd: process.cwd(),
                });
                log("info", "Comando ejecutado", { output: output.slice(0, 500) });
                return output;
            }

            case "open_app": {
                if (!command.app_name) return "Error: no se proporcionó nombre de app";
                execSync(`start "" "${command.app_name}"`, { shell: "cmd.exe" });
                return `Aplicación "${command.app_name}" abierta`;
            }

            case "close_app": {
                if (!command.app_name) return "Error: no se proporcionó nombre de app";
                execSync(`taskkill /IM "${command.app_name}" /F`, { encoding: "utf-8" });
                return `Aplicación "${command.app_name}" cerrada`;
            }

            case "file_read": {
                if (!command.path) return "Error: no se proporcionó ruta";
                const content = fs.readFileSync(command.path, "utf-8");
                return content.slice(0, 5000);
            }

            case "file_write": {
                if (!command.path) return "Error: no se proporcionó ruta";
                const dir = path.dirname(command.path);
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(command.path, command.content ?? "");
                return `Archivo escrito: ${command.path}`;
            }

            case "file_move": {
                if (!command.path || !command.destination) return "Error: faltan rutas";
                fs.renameSync(command.path, command.destination);
                return `Archivo movido: ${command.path} → ${command.destination}`;
            }

            case "file_delete": {
                if (!command.path) return "Error: no se proporcionó ruta";
                fs.unlinkSync(command.path);
                return `Archivo eliminado: ${command.path}`;
            }

            case "list_dir": {
                const dirPath = command.path ?? process.cwd();
                const entries = fs.readdirSync(dirPath, { withFileTypes: true });
                const listing = entries.map(e => {
                    const type = e.isDirectory() ? "📁" : "📄";
                    try {
                        const stats = fs.statSync(path.join(dirPath, e.name));
                        const size = e.isFile() ? ` (${stats.size} bytes)` : "";
                        return `${type} ${e.name}${size}`;
                    } catch {
                        return `${type} ${e.name}`;
                    }
                });
                return listing.join("\n");
            }

            case "system_info": {
                return getDesktopContext();
            }

            default:
                return `Acción desconocida: ${command.action}`;
        }
    } catch (err) {
        const msg = (err as Error).message;
        log("error", `Error ejecutando acción desktop: ${command.action}`, { error: msg });
        return `Error: ${msg}`;
    }
}

/* ============================================================
   CRITIC
============================================================ */

async function evaluateStep(
    stepDescription: string,
    stepType: "browser" | "desktop",
    commandOutput?: string
): Promise<boolean> {
    let contextInfo: string;

    if (stepType === "browser" && browserPage) {
        contextInfo = `Elementos interactivos actuales:\n${await extractInteractiveDOM(browserPage)}`;
    } else {
        contextInfo = `Resultado de la ejecución:\n${commandOutput ?? "sin output"}`;
    }

    const response = await client.chat.completions.create({
        model: MODEL,
        messages: [
            {
                role: "system",
                content: "Evalúa si el paso se completó exitosamente. Responde SOLO true o false.",
            },
            {
                role: "user",
                content: `
Paso a evaluar: ${stepDescription}
Tipo: ${stepType}

${contextInfo}
                `,
            },
        ],
    });

    const result = response.choices[0].message.content
        ?.toLowerCase()
        .includes("true") ?? false;

    log("info", `Evaluación del paso: ${result ? "✅ exitoso" : "❌ no completado"}`, { stepDescription, result });
    return result;
}

async function evaluateGoal(goal: string): Promise<boolean> {
    const parts: string[] = [];

    if (browserPage) {
        parts.push(`Elementos web actuales:\n${await extractInteractiveDOM(browserPage)}`);
    }
    parts.push(`Contexto del sistema:\n${getDesktopContext()}`);

    const response = await client.chat.completions.create({
        model: MODEL,
        messages: [
            {
                role: "system",
                content: "Evalúa si el objetivo final se alcanzó. Responde SOLO true o false.",
            },
            {
                role: "user",
                content: `
Objetivo final: ${goal}

${parts.join("\n\n")}
                `,
            },
        ],
    });

    const result = response.choices[0].message.content
        ?.toLowerCase()
        .includes("true") ?? false;

    log("info", `Evaluación del objetivo global: ${result ? "🎯 alcanzado" : "⏳ en progreso"}`, { goal, result });
    return result;
}

/* ============================================================
   AGENTE PRINCIPAL
============================================================ */

async function runAgent() {
    initLogger();
    log("info", "Agente iniciado (modo dual: browser + desktop)");

    const goal = await askUser("🧠 ¿Qué quieres que haga el agente?\n> ");
    log("info", `Objetivo recibido: ${goal}`);
    const plan = await generatePlan(goal);

    const hasBrowser = plan.steps.some(s => s.type === "browser");
    const hasDesktop = plan.steps.some(s => s.type === "desktop");
    plan.steps.forEach((s, i) => {
        const icon = s.type === "browser" ? "🌐" : "💻";
    });

    const confirm = await askUser("\n¿Ejecutar plan? (si/no)\n> ");
    if (confirm.toLowerCase() !== "si") {
        log("info", "Ejecución cancelada por el usuario");
        return;
    }

    const graph = buildGraph(goal, plan);

    while (true) {
        const node = selectNextNode(graph);
        if (!node) break;

        const icon = node.type === "browser" ? "🌐" : "💻";
        log("info", `🚀 Ejecutando nodo ${icon}: ${node.id}`, {
            description: node.description,
            type: node.type,
            attempt: node.attempts + 1,
        });

        node.status = "in_progress";
        node.attempts++;

        try {
            let commandOutput: string | undefined;

            if (node.type === "browser") {
                const page = await getBrowserPage();
                const command = await stepToBrowserCommand(page, node.description);
                await executeBrowserCommand(page, command);
                await page.waitForTimeout(2000);
            } else {
                const command = await stepToDesktopCommand(node.description);
                commandOutput = await executeDesktopCommand(command);
            }

            // Evaluar el paso individual
            const stepSuccess = await evaluateStep(node.description, node.type, commandOutput);

            if (stepSuccess) {
                node.status = "completed";
                node.score += 0.5;
                log("info", `✅ Paso completado: ${node.id}`);
            } else {
                log("warn", `Paso ${node.id} no se completó según evaluación`);
                if (node.attempts >= MAX_ATTEMPTS) {
                    node.status = "failed";
                    node.priority -= 0.5;
                } else {
                    node.status = "pending";
                    node.priority += 0.2;
                }
                continue;
            }

            // Evaluar objetivo global como checkpoint
            const goalReached = await evaluateGoal(goal);
            if (goalReached) {
                log("info", "🎯 Objetivo global alcanzado");
                break;
            }

        } catch (err) {
            log("error", `Error ejecutando nodo ${node.id}`, { error: (err as Error).message });

            if (node.attempts >= MAX_ATTEMPTS) {
                node.status = "failed";
                node.priority -= 0.5;
            } else {
                node.status = "pending";
                node.priority += 0.2;
            }
        }
    }

    await closeBrowser();

    log("info", "📊 Estado final del grafo", graph);
    log("info", `Logs guardados en: ${logFilePath}`);
}

runAgent().catch((err) => {
    log("error", "Error fatal en el agente", { error: (err as Error).message });
    process.exit(1);
});
