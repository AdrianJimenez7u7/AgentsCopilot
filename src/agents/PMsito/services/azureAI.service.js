import { AzureOpenAI } from 'openai';

export class AzureAIService {
    constructor() {
        this.endpoint = 'https://ia-generativa.cognitiveservices.azure.com/';
        this.apiKey = process.env.AZURE_API_KEY;
        this.apiVersion = process.env.AZURE_OPENAI_API_VERSION;
        this.deployment = process.env.AZURE_OPENAI_MODEL;
        this.model = this.deployment;
        this.client = new AzureOpenAI({
            endpoint: this.endpoint,
            apiKey: this.apiKey,
            apiVersion: this.apiVersion,
            deployment: this.deployment,
        });
    }

    async generarRespuesta(prompt, systemPrompt) {
        try {
            const response = await this.client.chat.completions.create({
                model: this.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: prompt },
                ],
                response_format: { type: 'json_object' },
                temperature: 0.2,
                max_tokens: 1200,
            });

            return response.choices?.[0]?.message?.content?.trim() || '';
        } catch (error) {
            console.error('Error al generar respuesta con Azure OpenAI:', error);
            throw error;
        }
    }
}

