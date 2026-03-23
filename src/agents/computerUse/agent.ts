import OpenAI from "openai";
import { chromium, BrowserContext, Page } from "playwright";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

/* ============================================================
   CONFIGURACIÓN
============================================================ */

const MODEL = "nvidia/nemotron-nano-12b-v2-vl:free";
// Resolve paths relative to project root (dist/src/agent.js → ../../)
const PROJECT_ROOT = path.resolve(__dirname, "../../");
const USER_DATA_DIR = path.join(PROJECT_ROOT, "user-data");
const MAX_ATTEMPTS = 3;
const MAX_PARSE_RETRIES = 2;
const LOGS_DIR = path.join(PROJECT_ROOT, "logs");

const DANGEROUS_ACTIONS = new Set([
    "run_command", "close_app", "file_delete", "file_write", "file_move",
]);

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

export interface AgentCallbacks {
    onLog: (level: "info" | "warn" | "error", message: string, data?: unknown) => void;
    onPlanReady: (plan: Plan) => Promise<boolean>;
    onConfirmDangerous: (action: string, details: string) => Promise<boolean>;
    onStatus: (status: string) => void;
    onNodeUpdate: (nodeId: string, status: NodeStatus) => void;
    onDone: (success: boolean) => void;
}

/* ============================================================
   LOGGER
============================================================ */

function createLogger(callbacks: AgentCallbacks) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logFilePath = path.join(LOGS_DIR, `run-${timestamp}.jsonl`);

    return function log(level: "info" | "warn" | "error", message: string, data?: unknown) {
        const entry = { timestamp: new Date().toISOString(), level, message, ...(data !== undefined && { data }) };
        callbacks.onLog(level, message, data);
        fs.appendFileSync(logFilePath, JSON.stringify(entry) + "\n");
    };
}

/* ============================================================
   SAFE JSON PARSING
============================================================ */

function safeParseLLMJson(raw: string): unknown {
    let cleaned = raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
    try { return JSON.parse(cleaned); } catch { /* fallback */ }
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`No JSON válido: ${raw.slice(0, 200)}`);
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
            results.push(`<${tag} ${attrs.join(" ")}>${text}</${tag}>`);
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
    info.push(`User: ${os.userInfo().username}`);
    info.push(`Home: ${os.homedir()}`);
    info.push(`CWD: ${process.cwd()}`);
    info.push(`RAM libre: ${Math.round(os.freemem() / 1024 / 1024)}MB / ${Math.round(os.totalmem() / 1024 / 1024)}MB`);
    try {
        const tasks = execSync("tasklist /FO CSV /NH", { encoding: "utf-8", timeout: 5000 });
        const apps = tasks.split("\n").slice(0, 20)
            .map(line => line.split(",")[0]?.replace(/"/g, ""))
            .filter(Boolean);
        info.push(`\nProcesos (top 20): ${apps.join(", ")}`);
    } catch { info.push("Procesos: no disponible"); }
    return info.join("\n");
}

/* ============================================================
   NAVEGADOR (LAZY INIT)
============================================================ */

let browserContext: BrowserContext | null = null;
let browserPage: Page | null = null;

async function getBrowserPage(): Promise<Page> {
    if (!browserPage) {
        browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
            headless: false,
            viewport: { width: 1280, height: 800 },
            locale: "es-MX",
        });
        browserPage = await browserContext.newPage();
    }
    return browserPage;
}

async function closeBrowser() {
    if (browserContext) {
        await browserPage?.waitForTimeout(1500);
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

Clasifica cada paso según su dominio. Devuelve SOLO JSON válido.

Formato:
{
  "steps": [
    { "id": "step1", "description": "descripcion clara del paso", "type": "browser | desktop", "priority": 1, "dependencies": [] }
  ]
}
`;

async function generatePlan(client: OpenAI, goal: string, log: ReturnType<typeof createLogger>): Promise<Plan> {
    for (let attempt = 0; attempt <= MAX_PARSE_RETRIES; attempt++) {
        const response = await client.chat.completions.create({
            model: MODEL,
            messages: [
                { role: "system", content: PLANNER_SYSTEM_PROMPT },
                { role: "user", content: `Objetivo: ${goal}` },
            ],
        });
        const raw = response.choices?.[0]?.message?.content ?? "";
        if (!raw) throw new Error("El modelo no devolvió contenido");
        try {
            const plan = PlanSchema.parse(safeParseLLMJson(raw));
            log("info", "Plan generado exitosamente", plan);
            return plan;
        } catch (err) {
            log("warn", `Intento ${attempt + 1} de parsing falló`, { error: (err as Error).message });
            if (attempt === MAX_PARSE_RETRIES) throw err;
        }
    }
    throw new Error("No se pudo generar el plan");
}

/* ============================================================
   GOAL GRAPH
============================================================ */

function buildGraph(goal: string, plan: Plan): GoalGraph {
    const nodes: Record<string, GoalNode> = {};
    for (const step of plan.steps) {
        nodes[step.id] = {
            id: step.id, description: step.description, type: step.type,
            priority: step.priority ?? 1, dependencies: step.dependencies ?? [],
            status: "pending", attempts: 0, score: 0,
        };
    }
    return { goal, nodes };
}

function dependenciesSatisfied(node: GoalNode, graph: GoalGraph): boolean {
    return node.dependencies.every(dep => graph.nodes[dep]?.status === "completed");
}

function selectNextNode(graph: GoalGraph): GoalNode | null {
    const candidates = Object.values(graph.nodes)
        .filter(n => n.status === "pending")
        .filter(n => dependenciesSatisfied(n, graph));
    if (!candidates.length) return null;
    candidates.sort((a, b) => (b.priority + b.score) - (a.priority + a.score));
    return candidates[0];
}

/* ============================================================
   BROWSER EXECUTOR
============================================================ */

async function stepToBrowserCommand(client: OpenAI, page: Page, description: string, log: ReturnType<typeof createLogger>): Promise<BrowserCommand> {
    const dom = await extractInteractiveDOM(page);
    for (let attempt = 0; attempt <= MAX_PARSE_RETRIES; attempt++) {
        const response = await client.chat.completions.create({
            model: MODEL,
            messages: [
                {
                    role: "system",
                    content: `Convierte la instrucción en una acción de NAVEGADOR. Devuelve SOLO JSON válido.
Formato: { "domain": "browser", "action": "...", ... }
Acciones: click, type, navigate, scroll, hover, select, wait, go_back.
Campos: action (requerido), target (selector CSS), text, url, value.`,
                },
                { role: "user", content: `Paso: ${description}\n\nElementos interactivos:\n${dom}` },
            ],
        });
        const raw = response.choices?.[0]?.message?.content ?? "";
        if (!raw) throw new Error("El modelo no devolvió contenido");
        try {
            const command = BrowserCommandSchema.parse(safeParseLLMJson(raw));
            log("info", `Comando browser: ${command.action}`, command);
            return command;
        } catch (err) {
            log("warn", `Intento ${attempt + 1} browser falló`, { error: (err as Error).message });
            if (attempt === MAX_PARSE_RETRIES) throw err;
        }
    }
    throw new Error("No se pudo generar comando browser");
}

async function executeBrowserCommand(page: Page, command: BrowserCommand) {
    switch (command.action) {
        case "navigate": if (command.url) await page.goto(command.url); break;
        case "type": if (command.target) { await page.fill(command.target, command.text ?? ""); await page.keyboard.press("Enter"); } break;
        case "click": if (command.target) await page.click(command.target); break;
        case "scroll": await page.evaluate((d) => window.scrollBy(0, d), parseInt(command.value ?? "500", 10)); break;
        case "hover": if (command.target) await page.hover(command.target); break;
        case "select": if (command.target) await page.selectOption(command.target, command.value ?? ""); break;
        case "wait": await page.waitForTimeout(parseInt(command.value ?? "1000", 10)); break;
        case "go_back": await page.goBack(); break;
    }
}

/* ============================================================
   DESKTOP EXECUTOR
============================================================ */

async function stepToDesktopCommand(client: OpenAI, description: string, log: ReturnType<typeof createLogger>): Promise<DesktopCommand> {
    const context = getDesktopContext();
    for (let attempt = 0; attempt <= MAX_PARSE_RETRIES; attempt++) {
        const response = await client.chat.completions.create({
            model: MODEL,
            messages: [
                {
                    role: "system",
                    content: `Convierte la instrucción en una acción de ESCRITORIO. Devuelve SOLO JSON válido.
Formato: { "domain": "desktop", "action": "...", ... }
Acciones disponibles: run_command, open_app, close_app, file_read, file_write, file_move, file_delete, list_dir, system_info.
SO: Windows. Usa comandos compatibles con cmd/powershell.`,
                },
                { role: "user", content: `Paso: ${description}\n\nContexto:\n${context}` },
            ],
        });
        const raw = response.choices?.[0]?.message?.content ?? "";
        if (!raw) throw new Error("El modelo no devolvió contenido");
        try {
            const command = DesktopCommandSchema.parse(safeParseLLMJson(raw));
            log("info", `Comando desktop: ${command.action}`, command);
            return command;
        } catch (err) {
            log("warn", `Intento ${attempt + 1} desktop falló`, { error: (err as Error).message });
            if (attempt === MAX_PARSE_RETRIES) throw err;
        }
    }
    throw new Error("No se pudo generar comando desktop");
}

async function executeDesktopCommand(command: DesktopCommand, callbacks: AgentCallbacks, log: ReturnType<typeof createLogger>): Promise<string> {
    if (DANGEROUS_ACTIONS.has(command.action)) {
        const details = command.command ?? command.path ?? command.app_name ?? "sin detalles";
        const allowed = await callbacks.onConfirmDangerous(command.action, details);
        if (!allowed) {
            log("warn", "Acción rechazada por el usuario");
            return "ACCIÓN RECHAZADA POR EL USUARIO";
        }
    }
    try {
        switch (command.action) {
            case "run_command": {
                if (!command.command) return "Error: no se proporcionó comando";
                const output = execSync(command.command, { encoding: "utf-8", timeout: 30000, cwd: process.cwd() });
                log("info", "Comando ejecutado", { output: output.slice(0, 500) });
                return output;
            }
            case "open_app": {
                if (!command.app_name) return "Error: falta nombre de app";
                execSync(`start "" "${command.app_name}"`, { shell: "cmd.exe" });
                return `App "${command.app_name}" abierta`;
            }
            case "close_app": {
                if (!command.app_name) return "Error: falta nombre de app";
                execSync(`taskkill /IM "${command.app_name}" /F`, { encoding: "utf-8" });
                return `App "${command.app_name}" cerrada`;
            }
            case "file_read": {
                if (!command.path) return "Error: falta ruta";
                return fs.readFileSync(command.path, "utf-8").slice(0, 5000);
            }
            case "file_write": {
                if (!command.path) return "Error: falta ruta";
                fs.mkdirSync(path.dirname(command.path), { recursive: true });
                fs.writeFileSync(command.path, command.content ?? "");
                return `Archivo escrito: ${command.path}`;
            }
            case "file_move": {
                if (!command.path || !command.destination) return "Error: faltan rutas";
                fs.renameSync(command.path, command.destination);
                return `Movido: ${command.path} → ${command.destination}`;
            }
            case "file_delete": {
                if (!command.path) return "Error: falta ruta";
                fs.unlinkSync(command.path);
                return `Eliminado: ${command.path}`;
            }
            case "list_dir": {
                const dirPath = command.path ?? process.cwd();
                const entries = fs.readdirSync(dirPath, { withFileTypes: true });
                return entries.map(e => `${e.isDirectory() ? "📁" : "📄"} ${e.name}`).join("\n");
            }
            case "system_info": return getDesktopContext();
            default: return `Acción desconocida: ${command.action}`;
        }
    } catch (err) {
        const msg = (err as Error).message;
        log("error", `Error en acción desktop: ${command.action}`, { error: msg });
        return `Error: ${msg}`;
    }
}

/* ============================================================
   CRITIC
============================================================ */

async function evaluateStep(client: OpenAI, stepDescription: string, stepType: "browser" | "desktop", commandOutput?: string): Promise<boolean> {
    let contextInfo = stepType === "browser" && browserPage
        ? `Elementos actuales:\n${await extractInteractiveDOM(browserPage)}`
        : `Resultado:\n${commandOutput ?? "sin output"}`;

    const response = await client.chat.completions.create({
        model: MODEL,
        messages: [
            { role: "system", content: "Evalúa si el paso se completó exitosamente. Responde SOLO true o false." },
            { role: "user", content: `Paso: ${stepDescription}\nTipo: ${stepType}\n\n${contextInfo}` },
        ],
    });
    return response.choices?.[0]?.message?.content?.toLowerCase().includes("true") ?? false;
}

async function evaluateGoal(client: OpenAI, goal: string): Promise<boolean> {
    const parts: string[] = [];
    if (browserPage) parts.push(`Elementos web:\n${await extractInteractiveDOM(browserPage)}`);
    parts.push(`Sistema:\n${getDesktopContext()}`);

    const response = await client.chat.completions.create({
        model: MODEL,
        messages: [
            { role: "system", content: "Evalúa si el objetivo final se alcanzó. Responde SOLO true o false." },
            { role: "user", content: `Objetivo: ${goal}\n\n${parts.join("\n\n")}` },
        ],
    });
    return response.choices?.[0]?.message?.content?.toLowerCase().includes("true") ?? false;
}

/* ============================================================
   AGENTE PRINCIPAL (EXPORTADO)
============================================================ */

export async function runAgent(goal: string, apiKey: string, callbacks: AgentCallbacks): Promise<void> {
    const client = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey,
    });

    const log = createLogger(callbacks);
    log("info", `Objetivo recibido: ${goal}`);
    callbacks.onStatus("Generando plan...");

    let plan: Plan;
    try {
        plan = await generatePlan(client, goal, log);
    } catch (err) {
        log("error", "Error generando plan", { error: (err as Error).message });
        callbacks.onDone(false);
        return;
    }

    log("info", "Plan listo", plan);
    callbacks.onStatus("Plan listo — esperando confirmación");

    const confirmed = await callbacks.onPlanReady(plan);
    if (!confirmed) {
        log("info", "Ejecución cancelada por el usuario");
        callbacks.onDone(false);
        return;
    }

    callbacks.onStatus("Ejecutando plan...");
    const graph = buildGraph(goal, plan);

    while (true) {
        const node = selectNextNode(graph);
        if (!node) break;

        log("info", `Ejecutando: ${node.id} — ${node.description}`, { type: node.type });
        callbacks.onStatus(`Ejecutando: ${node.description}`);
        node.status = "in_progress";
        node.attempts++;
        callbacks.onNodeUpdate(node.id, "in_progress");

        try {
            let commandOutput: string | undefined;

            if (node.type === "browser") {
                const page = await getBrowserPage();
                const command = await stepToBrowserCommand(client, page, node.description, log);
                await executeBrowserCommand(page, command);
                await page.waitForTimeout(2000);
            } else {
                const command = await stepToDesktopCommand(client, node.description, log);
                commandOutput = await executeDesktopCommand(command, callbacks, log);
                log("info", `Output: ${commandOutput.slice(0, 300)}`);
            }

            const stepSuccess = await evaluateStep(client, node.description, node.type, commandOutput);

            if (stepSuccess) {
                node.status = "completed";
                node.score += 0.5;
                log("info", `✅ Paso completado: ${node.id}`);
                callbacks.onNodeUpdate(node.id, "completed");
            } else {
                log("warn", `Paso ${node.id} no completado`);
                if (node.attempts >= MAX_ATTEMPTS) {
                    node.status = "failed";
                    node.priority -= 0.5;
                    callbacks.onNodeUpdate(node.id, "failed");
                } else {
                    node.status = "pending";
                    node.priority += 0.2;
                    callbacks.onNodeUpdate(node.id, "pending");
                }
                continue;
            }

            const goalReached = await evaluateGoal(client, goal);
            if (goalReached) {
                log("info", "🎯 Objetivo alcanzado");
                break;
            }

        } catch (err) {
            log("error", `Error en nodo ${node.id}`, { error: (err as Error).message });
            if (node.attempts >= MAX_ATTEMPTS) {
                node.status = "failed";
                callbacks.onNodeUpdate(node.id, "failed");
            } else {
                node.status = "pending";
                callbacks.onNodeUpdate(node.id, "pending");
            }
        }
    }

    await closeBrowser();
    log("info", "📊 Agente finalizado");
    callbacks.onStatus("Finalizado");
    callbacks.onDone(true);
}
