import { OpenAIService } from "../services/openAI.service.js";
import { SearchService } from "../services/search.service.js";
import { RestriccionesService } from "../services/restricciones.service.js";
import { AdaptiveCardService } from "../services/adaptiveCard.service.js";

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
    static async getPermissions(req, res) {
        const email = req.body.email;
        if (!email) {
            return res.status(400).json({ error: "Email es requerido" });
        }
        const permissions = RestriccionesService.getPermissions(email);
        return res.status(200).json({ permissions });
    }

    static async getProductCard(req, res) {
        const sku = req.body.sku;
        const cliente = req.body.cliente; // Recibimos el cliente si viene en la petición

        if (!sku) {
            return res.status(400).json({ error: "SKU es requerido" });
        }

        try {
            // Reutilizamos la lógica de búsqueda y extracción
            const rawResults = await SearchService.search(sku);
            const contextString = JSON.stringify(rawResults);
            const productoLimpio = await OpenAIService.extractProductData(sku, contextString);

            // Si nos enviaron el cliente, lo agregamos al objeto para que se guarde en la tarjeta
            if (cliente) {
                productoLimpio.cliente = cliente;
            }

            // Generamos la tarjeta con los datos obtenidos
            const card = AdaptiveCardService.createProductCard(productoLimpio);

            return res.status(200).json(card);
        } catch (error) {
            console.error("Error generating product card:", error);
            return res.status(500).json({ error: "Error generando la tarjeta de producto" });
        }
    }

    static async isSearchUser(req, res) {
        const email = req.body.email;
        if (!email) {
            return res.status(400).json({ error: "Email es requerido" });
        }
        const isSearchUser = RestriccionesService.isSearchUser(email);
        return res.status(200).json({ isSearchUser });
    }

    static async isTicketUser(req, res) {
        const email = req.body.email;
        if (!email) {
            return res.status(400).json({ error: "Email es requerido" });
        }
        const isTicketUser = RestriccionesService.isTicketUser(email);
        return res.status(200).json({ isTicketUser });
    }
}