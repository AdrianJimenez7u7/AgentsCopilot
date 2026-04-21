import { OpenAIService } from "../services/openAI.service.js";
import { SearchService } from "../services/search.service.js";
import { RestriccionesService } from "../services/restricciones.service.js";
import { AdaptiveCardService } from "../services/adaptiveCard.service.js";
import { operacionesService } from "../services/operaciones.service.js";
import multer from 'multer';
import { PrismaClient } from '@prisma/client';
import { Constantes } from "../utils/constantes.js";
import { powerAppsService } from "../services/powerApps.service.js";
import { SapService } from "../services/sap.service.js";
import { randomUUID } from 'crypto';

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
        const telemetry = {
            runId: randomUUID(),
            collaboratorId: req.body.email || null,
        };
        if (!sku) {
            return res.status(400).json({ error: "SKU es requerido" });
        }
        const rawResults = await SearchService.search(sku, 2, telemetry);
        if (!rawResults?.results?.length) {
            return res.status(422).json({
                error: "No se encontró contexto web confiable para un producto de tecnología. Intenta nuevamente con otro SKU o valida el número de parte."
            });
        }
        const contextString = JSON.stringify(rawResults);

        const productoLimpio = await OpenAIService.clasificarProductoRazonamiento(sku, contextString, 3, telemetry);
        return res.status(200).json(productoLimpio);
    }
    /**
     * TEST ENDPOINT: Recibe un SKU, busca el producto con Tavily y lo clasifica
     * con el modelo de razonamiento gpt-5-mini. Devuelve clasificación + tokens reales.
     */
    static async clasificarProductoTest(req, res) {
        const sku = req.body.sku;
        const telemetry = {
            runId: randomUUID(),
            collaboratorId: req.body.email || null,
        };
        if (!sku) {
            return res.status(400).json({ error: "SKU es requerido" });
        }

        try {
            console.log(`[ClasificarTest] Iniciando búsqueda para SKU: ${sku}`);
            const rawResults = await SearchService.search(sku, 2, telemetry);
            if (!rawResults?.results?.length) {
                return res.status(422).json({
                    status: 422,
                    sku,
                    message: "La búsqueda no devolvió evidencia suficiente de un producto de tecnología."
                });
            }
            const contextString = JSON.stringify(rawResults);

            console.log(`[ClasificarTest] Búsqueda completa. Clasificando con modelo de razonamiento...`);
            const resultado = await OpenAIService.clasificarProductoRazonamiento(sku, contextString, 3, telemetry);

            return res.status(200).json({
                status: 200,
                sku,
                resultado
            });
        } catch (error) {
            console.error(`[ClasificarTest] Error para SKU ${sku}:`, error?.message ?? error);
            return res.status(500).json({
                status: 500,
                message: "Error al clasificar el producto.",
                error: error?.message ?? String(error)
            });
        }
    }

    /**
     * DELETE /search/pending/:id
     * Elimina un producto pendiente (status=Pending) de la base de datos.
     */
    static async deletePendingProduct(req, res) {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }
        try {
            const existing = await prisma.productoPendienteValidation.findUnique({ where: { id } });
            if (!existing) {
                return res.status(404).json({ error: 'Producto no encontrado' });
            }
            await prisma.productoPendienteValidation.delete({ where: { id } });
            console.log(`[Delete] Producto id:${id} (SKU: ${existing.sku}) eliminado`);
            return res.status(200).json({ message: 'Producto eliminado correctamente', sku: existing.sku });
        } catch (error) {
            console.error(`[Delete] Error al eliminar id:${id}:`, error?.message ?? error);
            return res.status(500).json({ error: 'Error al eliminar el producto.' });
        }
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
        const telemetry = {
            runId: randomUUID(),
            collaboratorId: req.body.email || null,
        };

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
                const rawResults = await SearchService.search(sku, 2, telemetry);
                if (!rawResults?.results?.length) {
                    const card = AdaptiveCardService.createErrorCard(
                        sku,
                        "No se encontró evidencia confiable de que el SKU corresponda a un producto de tecnología. Verifica el número de parte e inténtalo de nuevo."
                    );
                    return res.status(200).json(card);
                }
                const contextString = JSON.stringify(rawResults);
                // retries=0: fail fast for card requests — error card is shown immediately
                productoLimpio = await OpenAIService.clasificarProductoRazonamiento(sku, contextString, 0, telemetry);
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

            // Guardar automáticamente el producto encontrado como "Pendiente" en DB
            // para que tenga un ID y se asocie a la sesión del Chat antes de Validarse.
            const newProduct = await prisma.productoPendienteValidation.create({
                data: {
                    sku: productoLimpio.numero_parte || sku,
                    descripcion_comercial: productoLimpio.descripcion_comercial || "",
                    clave_producto_servicio_sat: productoLimpio.clave_producto_servicio_sat || "",
                    clave_unidad_sat: productoLimpio.clave_unidad_sat || "H87",
                    marca: productoLimpio.marca || "",
                    medidas_cm: productoLimpio.medidas_cm || "0 x 0 x 0",
                    peso_kg: parseFloat(productoLimpio.peso_kg) || 0,
                    user_email: req.body.email || "bot@copilot.com",
                    status: 'Pending'
                }
            });

            productoLimpio.id = newProduct.id; // Inject ID to the card

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

            try {
                await powerAppsService.insertProductInSharepointList(updated);
            } catch (spError) {
                console.error("🔴 Error syncing to SharePoint:", spError);
            }

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
            const isSuperAdmin = RestriccionesService.isSuperAdmin(email);

            const whereClause = isSuperAdmin
                ? { status: 'Pending' }
                : { user_email: email, status: 'Pending' };

            const pending = await prisma.productoPendienteValidation.findMany({
                where: whereClause,
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

    static async getAllProducts(req, res) {
        try {
            const products = await prisma.productoPendienteValidation.findMany({
                orderBy: {
                    createdAt: 'desc'
                }
            });
            return res.status(200).json(products);
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
        // Exclude identity/read-only columns — SQL Server cannot update id
        const { status, id: _id, sku: _sku, createdAt: _createdAt, user_email: _email, ...rest } = req.body;
        const nextStatus = status || 'Validated';

        try {
            const previous = await prisma.productoPendienteValidation.findUnique({
                where: { id: parseInt(id) }
            });

            const updated = await prisma.productoPendienteValidation.update({
                where: { id: parseInt(id) },
                data: {
                    status: nextStatus,
                    ...rest
                }
            });

            // Sync to SharePoint only on transition to Validated to avoid duplicate inserts.
            if (nextStatus === 'Validated' && previous?.status !== 'Validated') {
                try {
                    await powerAppsService.insertProductInSharepointList(updated);
                } catch (spError) {
                    console.error("🔴 Error syncing validated product to SharePoint:", spError);
                }
            }

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
            const unidadesSAT = Constantes.UnidadesSAT;

            // Fix corrupted chars from Windows-1252 read as UTF-8
            // Each entry is: [garbled sequence, correct char]
            const charFixes = [
                [/\u00c3\u00b3/g, 'ó'], [/\u00c3\u00b3n/g, 'ón'],
                [/\u00c3\u00a9/g, 'é'], [/\u00c3\u00a1/g, 'á'],
                [/\u00c3\u00ad/g, 'í'], [/\u00c3\u00ba/g, 'ú'],
                [/\u00c3\u00b1/g, 'ñ'], [/\u00c3\u0091/g, 'Ñ'],
                [/\u00c3\u0093/g, 'Ó'], [/\u00c3\u0089/g, 'É'],
                [/\u00c3\u0081/g, 'Á'], [/\u00c3\u008d/g, 'Í'],
                [/\u00c3\u009a/g, 'Ú'], [/\u00fc/g, 'ü'],
                [/\ufffd/g, ''],  // fallback: remove remaining replacement chars
            ];

            const fixDesc = (str) => {
                let s = str;
                for (const [pattern, replacement] of charFixes) s = s.replace(pattern, replacement);
                return s.trim();
            };

            // Parse the full SAT catalog from the markdown table
            const catalogoCompleto = {};
            const lines = Constantes.CatalogoProdServSatMarkitdown.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('|') || trimmed.startsWith('| c_Clave') || trimmed.startsWith('| ---')) continue;
                const cols = trimmed.split('|').map(c => c.trim());
                if (cols.length < 3) continue;
                const rawKey = cols[1];
                const desc = fixDesc(cols[2]);
                if (!rawKey || !desc) continue;
                const key = rawKey.replace(/\.0$/, '');
                if (/^\d{8}$/.test(key)) {
                    catalogoCompleto[key] = desc;
                }
            }

            // Merge: CodigosClasificacion (curated names take priority)
            const codigosClasificacion = { ...catalogoCompleto, ...Constantes.CodigosClasificacion };

            console.log(`[Catalogo] Claves SAT totales: ${Object.keys(codigosClasificacion).length}`);
            return res.status(200).json({
                status: 200,
                message: "Marcas, codigos clasificacion y unidades SAT obtenidos exitosamente",
                data: { marcas, codigosClasificacion, unidadesSAT }
            });
        } catch (error) {
            console.error("Error fetching marcas and codigos clasificacion:", error);
            return res.status(500).json({ status: 500, message: "Error obteniendo marcas y codigos clasificacion", error: error });
        }
    }

    static async getMyData(req, res) {
        const email = req.body.email;
        if (!email) {
            return res.status(400).json({ error: "Email es requerido" });
        }
        try {
            const data = await powerAppsService.getMyCity(email);
            return res.status(200).json(data);
        } catch (error) {
            console.error("Error fetching my data:", error);
            return res.status(500).json({ error: "Error obteniendo mi data" });
        }
    }

    static async getProductsFromSharepointList(req, res) {
        try {
            const products = await powerAppsService.getProductsFromSharepointList();
            return res.status(200).json(products);
        } catch (error) {
            console.error("Error fetching products from sharepoint list:", error);
            return res.status(500).json({ error: "Error obteniendo productos de sharepoint list" });
        }
    }

    static async getSharepointListMetadata(req, res) {
        try {
            const metadata = await powerAppsService.getSharepointListMetadata();
            return res.status(200).json({
                status: 200,
                message: "Metadata de la lista de SharePoint obtenida exitosamente",
                data: metadata,
            });
        } catch (error) {
            console.error("Error fetching sharepoint list metadata:", error);
            return res.status(500).json({
                status: 500,
                error: "Error obteniendo metadata de la lista de SharePoint",
                details: error?.message ?? String(error),
            });
        }
    }

    /**
     * @param {purchaseOrder: number} req - El request
     * @returns {Object} { user: User }
     */
    static async getUserByPurchaseOrder(req, res) {
        const purchaseOrder = req.body.purchaseOrder;
        if (!purchaseOrder) {
            return res.status(400).json({ error: "Purchase order es requerido" });
        }
        try {
            const user = await SapService.getUserByPurchaseOrder(purchaseOrder);
            return res.status(200).json(user);
        } catch (error) {
            console.error("Error fetching user by purchase order:", error);
            return res.status(500).json({ error: "Error obteniendo usuario por purchase order" });
        }
    }
}

