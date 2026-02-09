import { OpenAIService } from "../services/openAI.service.js";
import { SearchService } from "../services/search.service.js";

export class ProductosController {

    /**
     * @request {string} sku - El código del producto
     * @returns {string} texto limpio para SAP
     */
    static async extractProductData(req, res) {

        const sku = req.body.sku;
        if (!sku) {
            return res.status(400).json({ error: "SKU es requerido" });
        }
        const rawResults = await SearchService.search(sku);
        const contextString = JSON.stringify(rawResults);

        const productoLimpio = await OpenAIService.extractProductData(sku, contextString);
        return res.status(200).json(productoLimpio);
    }
}