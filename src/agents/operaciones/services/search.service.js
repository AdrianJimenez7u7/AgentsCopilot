import { tavily } from '@tavily/core';
const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });

export class SearchService {

    static async search(sku, retries = 2) {
        // Exact SKU match + technical specs in Spanish for better results
        const query = `"${sku}" ficha técnica especificaciones peso dimensiones marca descripción`;

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const response = await tvly.search(query, {
                    searchDepth: "advanced",
                    maxResults: 3,
                    includeImages: false,
                    includeRawContent: false,
                });
                return response;
            } catch (error) {
                if (attempt < retries) {
                    const wait = 1000 * Math.pow(2, attempt); // 1s, 2s
                    console.warn(`Tavily retry ${attempt + 1} for SKU ${sku} in ${wait}ms`);
                    await new Promise(r => setTimeout(r, wait));
                } else {
                    console.error(`Tavily failed for SKU ${sku} after ${retries + 1} attempts:`, error.message);
                    return null;
                }
            }
        }
    }
}