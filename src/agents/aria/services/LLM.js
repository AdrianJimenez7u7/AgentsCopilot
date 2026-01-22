
export class LLMService {

    /**
     * Analyzes a date and returns a string with the date in a human-readable format.
     * @param date - The date to analyze.
     * @returns A string with the date in format MM/DD/YYYY.
     */
    static async analyzeDate(date) {
        try {
            const today = new Date();
            const todayStr = today.toLocaleDateString('en-US');

            // Generar referencia de los próximos 7 días para ayudar al modelo
            let calendarRef = 'Referencia próxima semana:\n';
            for (let i = 0; i < 8; i++) {
                const d = new Date(today);
                d.setDate(today.getDate() + i);
                const dStr = d.toLocaleDateString('en-US'); // MM/DD/YYYY
                const dName = d.toLocaleDateString('es-ES', { weekday: 'long' });
                calendarRef += `- ${i === 0 ? 'Hoy ' : ''}${dName}: ${dStr}\n`;
            }

            const propmt = `
Contexto: 
${calendarRef}

Tarea: Identifica la fecha exacta basada en la referencia anterior.
Entrada: "${date}"
Reglas:
- Retorna SOLO la fecha en formato MM/DD/YYYY.
- "el jueves", "este jueves" se refiere al jueves más próximo en la lista.
- "siguiente jueves" o "próximo jueves" usualmente implica la próxima semana si el jueves está muy cerca, pero usa tu sentido común basado en la lista. Prioriza el futuro inmediato.
`.trim();
            const payload = {
                messages: [{ role: 'user', content: propmt }],
                max_completion_tokens: 30,
                temperature: 0.3,
                top_p: 1,
                frequency_penalty: 0,
                presence_penalty: 0,
                model: 'gpt-4.1-nano'
            };
            const AZURE_API_KEY = process.env.AZURE_API_KEY || '';
            if (!AZURE_API_KEY) {
                throw new Error('AZURE_API_KEY no configurada en el entorno');
            }

            const url = 'https://ia-generativa.openai.azure.com/openai/deployments/gpt-4.1-nano/chat/completions?api-version=2025-01-01-preview';
            let resp;
            try {
                resp = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'api-key': AZURE_API_KEY
                    },
                    body: JSON.stringify(payload),
                });
            } catch (err) {
                throw new Error(`Error de red al llamar a Azure OpenAI: ${err.message || err}`);
            }
            const data = await resp.json();
            // Support both possible response shapes: choices[0].message.content or choices[0].content
            let contenido = (data.choices?.[0]?.message?.content ?? data.choices?.[0]?.content ?? '').trim();
            return contenido;
        } catch (error) {
            console.error('Error analyzing data:', error);
            throw error;
        }
    }
}