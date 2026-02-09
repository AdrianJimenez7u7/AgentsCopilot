import { tavily } from '@tavily/core';
const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });

export class SearchService {

    static async search(sku) {
        const query = `${sku} specifications datasheet dimensions weight technical spec`;

        try {
            const response = await tvly.search(query, {
                searchDepth: "advanced",
                maxResults: 5,
                includeImages: true,
                includeRawContent: false
            });
            return response;

        } catch (error) {
            console.error("Error conectando con Tavily:", error);
            return null;
        }
    }
}