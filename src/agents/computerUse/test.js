import "dotenv/config";
import OpenAI from "openai";
import { chromium } from "playwright";

// Configuración de OpenRouter
const apiKey = process.env.COMPUTER_USE_API_KEY;
//const modelName = "qwen/qwen3-vl-30b-a3b-thinking"; // Too heavy for free tier
//const modelName = "google/gemini-2.0-flash-lite-preview-02-05:free"; // Free, good for vision
const modelName = "nvidia/nemotron-nano-12b-v2-vl:free"; // Often returns 400

const client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: apiKey,
});

async function runComputerUse() {
    // 1. Lanzar navegador con viewport controlado
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        viewport: { width: 1080, height: 720 },
        deviceScaleFactor: 1
    });

    const page = await context.newPage();

    console.log("Navegando a Google...");
    await page.goto("https://www.google.com");

    // Esperar a que cargue
    await page.waitForLoadState("networkidle");

    // 2. Captura de pantalla optimizada
    const screenshot = await page.screenshot({
        encoding: "base64",
        type: "jpeg",
        quality: 60
    });

    console.log(`Captura lista. Tamaño del string: ${Math.round(screenshot.length / 1024)} KB`);

    try {
        let retries = 3;
        let response;

        while (retries > 0) {
            try {
                console.log(`Consultando a ${modelName}... (Intentos restantes: ${retries})`);
                response = await client.chat.completions.create({
                    model: modelName,
                    messages: [
                        {
                            role: "system",
                            content: `Eres un agente de automatización. 
                            Analiza la imagen y devuelve un JSON con la acción a realizar. 
                            Usa selectores CSS precisos (ej. 'textarea[name="q"]' o 'input[type="submit"]').
                            Formato: { "action": "type" | "click", "target": "selector", "text": "texto_si_aplica" }`
                        },
                        {
                            role: "user",
                            content: [
                                { type: "text", text: "Busca 'Noticias de IA en México' en Google." },
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: `data:image/jpeg;base64,${screenshot}`,
                                        // detail removed for broader compatibility
                                    }
                                }
                            ]
                        }
                    ],
                });
                break; // Success
            } catch (error) {
                console.error(`Error al consultar modelo: ${error.message}`);
                retries--;
                if (retries === 0) throw error;
                console.log(`Reintentando en 3 segundos...`);
                await new Promise(r => setTimeout(r, 3000));
            }
        }

        const content = response.choices[0].message.content;
        console.log("Respuesta del modelo:", content);

        // Limpieza básica de JSON (por si el modelo incluye markdown)
        const jsonStr = content.replace(/```json\n?|\n?```/g, "").trim();
        const command = JSON.parse(jsonStr);

        console.log("Comando interpretado:", command);

        // 3. Ejecución de la acción
        if (command.action === "type") {
            await page.waitForSelector(command.target, { timeout: 5000 });
            await page.fill(command.target, command.text);
            await page.keyboard.press("Enter");
            console.log(`Escribiendo "${command.text}" en ${command.target}`);
        } else if (command.action === "click") {
            await page.waitForSelector(command.target, { timeout: 5000 });
            await page.click(command.target);
            console.log(`Haciendo click en ${command.target}`);
        }

        // Dar tiempo para ver el resultado
        await page.waitForLoadState("networkidle");
        console.log("Tarea ejecutada con éxito.");

    } catch (error) {
        console.error("Error en el ciclo del agente:", error.message || error);
        if (error.response) {
            console.error("Detalles del error:", error.response.data);
        }
    } finally {
        await new Promise(r => setTimeout(r, 8000));
        await browser.close();
    }
}

runComputerUse().catch(console.error);