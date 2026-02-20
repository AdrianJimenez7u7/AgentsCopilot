import { OpenAIService } from "../services/openAI.service.js";
import { SearchService } from "../services/search.service.js";
import { RestriccionesService } from "../services/restricciones.service.js";
import { AdaptiveCardService } from "../services/adaptiveCard.service.js";
import { operacionesService } from "../services/operaciones.service.js";
import multer from 'multer';
import { PrismaClient } from '@prisma/client';
import { Constantes } from "../utils/constantes.js";

const prisma = new PrismaClient();

// Configure multer for file uploads
const upload = multer({
    dest: 'src/agents/operaciones/data/', // Temporary folder for uploads
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

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
        const cliente = req.body.cliente;

        if (!sku) {
            return res.status(400).json({ error: "SKU es requerido" });
        }

        try {
            // Check if SKU already exists in DB (any status)
            const existing = await prisma.productoPendienteValidation.findFirst({
                where: { sku },
                orderBy: { createdAt: 'desc' }
            });

            if (existing) {
                const card = AdaptiveCardService.createExistingProductCard(existing);
                return res.status(200).json(card);
            }

            // SKU is new — search and extract with AI
            let productoLimpio;
            try {
                const rawResults = await SearchService.search(sku);
                const contextString = JSON.stringify(rawResults);
                // retries=0: fail fast for card requests — error card is shown immediately
                productoLimpio = await OpenAIService.extractProductData(sku, contextString, 0);
            } catch (aiError) {
                console.error("AI error in getProductCard:", aiError.message);
                // Friendly error message depending on error type
                const isRateLimit = aiError?.status === 429 || aiError?.code === 'RateLimitReached';
                const friendlyMsg = isRateLimit
                    ? "El servicio de IA está temporalmente ocupado (límite de solicitudes). Por favor intenta de nuevo en unos segundos."
                    : "No fue posible obtener la información del producto en este momento.";
                const card = AdaptiveCardService.createErrorCard(sku, friendlyMsg);
                return res.status(200).json(card);
            }

            if (cliente) productoLimpio.cliente = cliente;

            const card = AdaptiveCardService.createProductCard(productoLimpio);
            return res.status(200).json(card);

        } catch (error) {
            console.error("Error in getProductCard:", error);
            const card = AdaptiveCardService.createErrorCard(sku, "Ocurrió un error inesperado. Por favor intenta de nuevo.");
            return res.status(200).json(card);
        }
    }

    /**
     * Called by Copilot Studio when the user submits the adaptive card.
     * Body: { id?, numero_parte, descripcion_comercial, clave_producto_servicio_sat,
     *         clave_unidad_sat, marca ("CODE - NAME" format), medidas_cm, peso_kg }
     */
    static async validateFromCard(req, res) {
        try {
            let { id, numero_parte, descripcion_comercial, clave_producto_servicio_sat,
                clave_unidad_sat, marca, medidas_cm, peso_kg } = req.body;

            // Convert marca from "CODE - NAME" → just the name (e.g. "287 - MICROSOFT" → "MICROSOFT")
            if (marca && marca.includes(' - ')) {
                marca = marca.split(' - ').slice(1).join(' - ').trim();
            }

            // If no id provided, look up by SKU
            if (!id && numero_parte) {
                const existing = await prisma.productoPendienteValidation.findFirst({
                    where: { sku: numero_parte, status: 'Pending' },
                    orderBy: { createdAt: 'desc' }
                });
                if (existing) id = existing.id;
            }

            if (!id) {
                return res.status(404).json({ error: "No se encontró el producto pendiente de validación." });
            }

            const updated = await prisma.productoPendienteValidation.update({
                where: { id: parseInt(id) },
                data: {
                    descripcion_comercial,
                    clave_producto_servicio_sat,
                    clave_unidad_sat,
                    marca,
                    medidas_cm,
                    peso_kg: parseFloat(peso_kg) || 0,
                    status: 'Validated',
                }
            });

            return res.status(200).json({ status: 200, message: "Producto validado correctamente.", data: updated });
        } catch (error) {
            console.error("Error validating from card:", error);
            return res.status(500).json({ status: 500, message: "Error al validar el producto.", error: error.message });
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

    static uploadXLSX = upload.single('file');

    /**
     * @request {File} document - El documento
     * @returns {Array<string>} lista de skus
     */
    static async extractSKUfromXLSX(req, res) {
        try {
            if (!req.file || req.file.length === 0) {
                return res.status(400).json({ error: "Documento es requerido" });
            }
            if (!req.file.originalname.endsWith('.xlsx') && !req.file.originalname.endsWith('.xls') && !req.file.originalname.endsWith('.csv')) {
                return res.status(400).json({ error: "Documento debe ser .xlsx, .xls o .csv" });
            }
            const file = req.file;
            const email = req.body.email || 'unknown@example.com';
            const result = await operacionesService.extractSKUfromXLSX(file, email);

            const card = AdaptiveCardService.createUploadSummaryCard(result);
            return res.status(200).json(card);
        } catch (error) {
            console.error("Error extracting SKUs:", error);
            return res.status(500).json({ "status": 500, "message": "Error extrayendo SKUs", "error": error });
        }
    }

    /**
     * @param {email: string} req - El request
     * @returns {Array<Object>} lista de productos pendientes de validación
     */
    static async getPendingValidations(req, res) {
        const email = req.query.email;
        if (!email) {
            return res.status(400).json({ error: "Email es requerido" });
        }
        try {
            const pending = await prisma.productoPendienteValidation.findMany({
                where: {
                    user_email: email,
                    status: 'Pending'
                },
                orderBy: {
                    createdAt: 'desc'
                }
            });
            return res.status(200).json(pending);
        } catch (error) {
            console.error("Error fetching pending validations:", error);
            return res.status(500).json({ error: "Error obteniendo validaciones pendientes" });
        }
    }

    /**
     * @param {id: number, status: string, ...data: any} req - El request
     * @returns {Object} { id, status, ...data }
     */
    static async updateValidationStatus(req, res) {
        const { id } = req.params;
        const { status, ...data } = req.body;

        try {
            const updated = await prisma.productoPendienteValidation.update({
                where: { id: parseInt(id) },
                data: {
                    status: status,
                    ...data
                }
            });
            return res.status(200).json(updated);
        } catch (error) {
            console.error("Error updating validation status:", error);
            return res.status(500).json({ error: "Error actualizando estado de validación" });
        }
    }

    /**
     * @returns {Object} { marcas, codigosClasificacion }
     */
    static async getMarcasAndCodigosClasificacion(req, res) {
        try {
            const marcas = Constantes.CodigoMarcas;
            const codigosClasificacion = Constantes.CodigosClasificacion;
            const unidadesSAT = Constantes.UnidadesSAT;
            return res.status(200).json({ status: 200, message: "Marcas, codigos clasificacion y unidades SAT obtenidos exitosamente", data: { marcas, codigosClasificacion, unidadesSAT } });
        } catch (error) {
            console.error("Error fetching marcas and codigos clasificacion:", error);
            return res.status(500).json({ status: 500, message: "Error obteniendo marcas y codigos clasificacion", error: error });
        }
    }
}