import { Constantes } from '../utils/constantes.js';
 
export class AdaptiveCardService {
 
    static createProductCard(productData) {
 
        // Hemos retirado los ChoiceSets masivos de Marca y SAT porque las
        // Tarjetas Adaptativas no soportan incrustar miles de registros estáticos
        // dentro del payload sin romper el render de Teams/Copilot.
 
        // Limpieza de Clave SAT (quitar ".0" si existe por error de la IA)
        let defaultSat = (productData.clave_producto_servicio_sat || "").toString().replace(/\.0$/, "");
        const defaultUnit = productData.clave_unidad_sat || "H87";
 
        // Lógica para encontrar la marca por defecto
        let defaultMarca = "";
        const marcaIA = (productData.marca || "").toUpperCase();
 
        if (marcaIA) {
            const foundEntry = Object.entries(Constantes.CodigoMarcas).find(([key, value]) => value === marcaIA);
            if (foundEntry) {
                defaultMarca = `${foundEntry[0]} - ${foundEntry[1]}`;
            } else {
                const potentialMatches = Object.entries(Constantes.CodigoMarcas)
                    .filter(([key, value]) => marcaIA.includes(value))
                    .sort((a, b) => b[1].length - a[1].length);
 
                if (potentialMatches.length > 0) {
                    const bestMatch = potentialMatches[0];
                    defaultMarca = `${bestMatch[0]} - ${bestMatch[1]}`;
                    console.log(`Marca parcial encontrada: IA="${marcaIA}" -> Catálogo="${bestMatch[1]}"`);
                }
            }
        }
 
        const VALIDATION_URL = `https://hubinn.compucad.com.mx/operaciones/validacion/?sku=${encodeURIComponent(productData.numero_parte || "")}`;
 
        // Construir opciones de SAT asegurando que el valor default existe en la lista
        const satChoices = Object.entries(Constantes.CodigosClasificacion).map(([code, name]) => ({
            title: `${code} - ${name}`,
            value: code
        }));
 
        if (defaultSat && !Constantes.CodigosClasificacion[defaultSat]) {
            satChoices.unshift({ title: `${defaultSat} (Sugerido por IA)`, value: defaultSat });
        }
 
        // Estructura simplificada solicitada por el usuario
        return {
            items: [
                {
                    type: "TextBlock",
                    text: `Validacion de Producto: ${productData.numero_parte || "N/A"}`
                },
                {
                    type: "Input.Text",
                    id: "descripcion_comercial",
                    value: productData.descripcion_comercial?.toUpperCase() || ""
                },
                {
                    type: "Input.ChoiceSet",
                    id: "clave_producto_servicio_sat",
                    choices: satChoices,
                    value: defaultSat,
                    placeholder: "Selecciona Clave SAT"
                },
                {
                    type: "Input.ChoiceSet",
                    id: "clave_unidad_sat",
                    choices: [
                        { title: "H87 - Pieza", value: "H87" },
                        { title: "E48 - Unidad de servicio", value: "E48" }
                    ],
                    value: defaultUnit
                },
                {
                    type: "Input.Text",
                    id: "marca",
                    value: defaultMarca
                },
                {
                    type: "Input.Text",
                    id: "medidas_cm",
                    value: productData.medidas_cm || "0 x 0 x 0"
                },
                {
                    type: "Input.Text",
                    id: "peso_kg",
                    value: String(productData.peso_kg || "0")
                },
                {
                    type: "Input.Text",
                    id: "numero_parte",
                    value: productData.numero_parte || "",
                    isVisible: false
                },
                {
                    type: "ActionSet",
                    spacing: "Large",
                    actions: [
                        {
                            type: "Action.OpenUrl",
                            title: "🔍 Ir a Validación",
                            url: VALIDATION_URL
                        }
                    ]
                }
            ]
        };
    }
 
    /** Card shown when the AI model fails (rate limit, timeout, etc.) */
    static createErrorCard(sku, errorMessage) {
        const VALIDATION_URL = `https://hubinn.compucad.com.mx/operaciones/validacion/?sku=${encodeURIComponent(sku || "")}`;
 
        return {
            type: "Container",
            style: "attention",
            items: [
                {
                    type: "TextBlock",
                    text: "⚠️ No se pudo procesar el producto",
                    weight: "Bolder",
                    size: "Medium",
                    color: "Attention"
                },
                {
                    type: "TextBlock",
                    text: `SKU: **${sku}**`,
                    spacing: "Small"
                },
                {
                    type: "TextBlock",
                    text: errorMessage || "Ocurrió un error al consultar la información del producto. Por favor intenta de nuevo en unos momentos.",
                    wrap: true,
                    isSubtle: true,
                    spacing: "Small"
                },
                {
                    type: "ActionSet",
                    spacing: "Medium",
                    actions: [
                        {
                            type: "Action.OpenUrl",
                            title: "🔍 Ir a Validación",
                            url: VALIDATION_URL
                        }
                    ]
                }
            ]
        };
    }
 
    /** Card shown when the SKU already exists in DB — shows current data */
    static createExistingProductCard(product) {
        const fields = [
            { label: "Descripción", value: product.descripcion_comercial || "—" },
            { label: "Marca", value: product.marca || "—" },
            { label: "Clave SAT", value: product.clave_producto_servicio_sat || "—" },
            { label: "Unidad SAT", value: product.clave_unidad_sat || "—" },
            { label: "Medidas (cm)", value: product.medidas_cm || "—" },
            { label: "Peso (kg)", value: String(product.peso_kg ?? "—") },
            { label: "Estatus", value: product.status || "—" },
        ];
 
        return {
            type: "Container",
            style: "emphasis",
            items: [
                {
                    type: "TextBlock",
                    text: "ℹ️ El producto ya existe",
                    weight: "Bolder",
                    size: "Medium",
                    color: "Accent"
                },
                {
                    type: "TextBlock",
                    text: `SKU: **${product.sku}** ya se encuentra registrado en el sistema.`,
                    wrap: true,
                    spacing: "Small"
                },
                {
                    type: "FactSet",
                    spacing: "Medium",
                    facts: fields.map(f => ({ title: f.label, value: f.value }))
                }
            ]
        };
    }
 
    /** Summary card shown after XLSX upload */
    static createUploadSummaryCard({ processed = [], skipped = [], errors = [] }) {
        const VALIDATION_URL = "https://hubinn.compucad.com.mx/operaciones/validacion/";
        const skuList = (arr) => arr.length > 0 ? arr.join(", ") : "Ninguno";
 
        return {
            type: "Container",
            items: [
                { type: "TextBlock", text: "📦 Resumen de carga de productos", weight: "Bolder", size: "Medium" },
                {
                    type: "TextBlock",
                    text: `✅ Listos para validar: **${processed.length}**`,
                    color: "Good", spacing: "Medium"
                },
                { type: "TextBlock", text: skuList(processed), wrap: true, isSubtle: true, spacing: "Small" },
                {
                    type: "TextBlock",
                    text: `ℹ️ Ya existían en el sistema: **${skipped.length}**`,
                    color: "Accent", spacing: "Medium"
                },
                { type: "TextBlock", text: skuList(skipped), wrap: true, isSubtle: true, spacing: "Small" },
                {
                    type: "TextBlock",
                    text: `❌ No se pudieron obtener: **${errors.length}**`,
                    color: "Attention", spacing: "Medium"
                },
                { type: "TextBlock", text: skuList(errors), wrap: true, isSubtle: true, spacing: "Small" },
                {
                    type: "ActionSet",
                    spacing: "Large",
                    actions: [
                        { type: "Action.OpenUrl", title: "🔍 Ir a Validación", url: VALIDATION_URL }
                    ]
                }
            ]
        };
    }
}