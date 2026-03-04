import { Constantes } from '../utils/constantes.js';

export class AdaptiveCardService {

    static createProductCard(productData) {

        // Hemos retirado los ChoiceSets masivos de Marca y SAT porque las 
        // Tarjetas Adaptativas no soportan incrustar miles de registros estáticos
        // dentro del payload sin romper el render de Teams/Copilot.

        const defaultSat = productData.clave_producto_servicio_sat || "";
        const defaultUnit = productData.clave_unidad_sat || "";

        // Lógica para encontrar la marca por defecto
        let defaultMarca = "";
        const marcaIA = (productData.marca || "").toUpperCase();

        if (marcaIA) {
            // Buscamos si la marca de la IA coincide con algún nombre en la lista
            const foundEntry = Object.entries(Constantes.CodigoMarcas).find(([key, value]) => value === marcaIA);
            if (foundEntry) {
                // Si encontramos coincidencia exacta de nombre, seteamos el valor formateado
                defaultMarca = `${foundEntry[0]} - ${foundEntry[1]}`;
            } else {
                // Si no hay coincidencia exacta, intentamos búsqueda parcial
                // Revertimos la búsqueda: vemos si alguna marca del catálogo está CONTENIDA en la respuesta de la IA
                // Ejemplo: IA dice "HPE ARUBA", Catálogo tiene "ARUBA" (334). "HPE ARUBA".includes("ARUBA") -> Match.
                // Priorizamos la coincidencia más larga para evitar falsos positivos cortos si los hubiera.

                const potentialMatches = Object.entries(Constantes.CodigoMarcas)
                    .filter(([key, value]) => marcaIA.includes(value))
                    .sort((a, b) => b[1].length - a[1].length); // Ordenar por longitud descendente

                if (potentialMatches.length > 0) {
                    const bestMatch = potentialMatches[0];
                    defaultMarca = `${bestMatch[0]} - ${bestMatch[1]}`;
                    console.log(`Marca parcial encontrada: IA="${marcaIA}" -> Catálogo="${bestMatch[1]}"`);
                }
            }
        }

        const container = {
            type: "Container",
            items: [
                {
                    type: "TextBlock",
                    text: `Validación de Producto: ${productData.numero_parte}`,
                    weight: "Bolder",
                    size: "Medium"
                },
                {
                    type: "TextBlock",
                    text: "Por favor revisa y corrige la información sugerida por la IA.",
                    isSubtle: true,
                    wrap: true
                },

                // Descripción Comercial
                { type: "TextBlock", text: "Descripción Comercial", weight: "Bolder", size: "Small", spacing: "Medium" },
                {
                    type: "Input.Text",
                    id: "descripcion_comercial",
                    value: productData.descripcion_comercial?.toUpperCase() || "",
                    isMultiline: true
                },

                // Clave SAT
                { type: "TextBlock", text: "Clave Producto/Servicio SAT", weight: "Bolder", size: "Small", spacing: "Medium" },
                {
                    type: "Input.Text",
                    id: "clave_producto_servicio_sat",
                    value: defaultSat,
                    placeholder: "Ejemplo: 43211500"
                },

                // Clave Unidad
                { type: "TextBlock", text: "Clave Unidad SAT", weight: "Bolder", size: "Small", spacing: "Medium" },
                {
                    type: "Input.ChoiceSet",
                    id: "clave_unidad_sat",
                    style: "compact",
                    choices: [
                        { title: "H87 - Pieza (Físico)", value: "H87" },
                        { title: "E48 - Unidad de servicio (Intangible)", value: "E48" }
                    ],
                    value: defaultUnit,
                    placeholder: "Selecciona H87 o E48"
                },

                // Marca (Ahora ChoiceSet)
                { type: "TextBlock", text: "Marca", weight: "Bolder", size: "Small", spacing: "Medium" },
                {
                    type: "Input.Text",
                    id: "marca",
                    value: defaultMarca,
                    placeholder: "Ejemplo: 287 - MICROSOFT"
                },

                // Columnas: Medidas y Peso
                {
                    type: "ColumnSet",
                    columns: [
                        {
                            type: "Column",
                            width: "stretch",
                            items: [
                                { type: "TextBlock", text: "Medidas (cm)", weight: "Bolder", size: "Small" },
                                {
                                    type: "Input.Text",
                                    id: "medidas_cm",
                                    value: productData.medidas_cm || "0 x 0 x 0"
                                }
                            ]
                        },
                        {
                            type: "Column",
                            width: "stretch",
                            items: [
                                { type: "TextBlock", text: "Peso (kg)", weight: "Bolder", size: "Small" },
                                {
                                    type: "Input.Text",
                                    id: "peso_kg",
                                    value: String(productData.peso_kg || "0")
                                }
                            ]
                        }
                    ]
                },

                // IDs ocultos
                {
                    type: "Input.Text",
                    id: "id",
                    value: String(productData.id || ""),
                    isVisible: false
                },
                {
                    type: "Input.Text",
                    id: "numero_parte",
                    value: productData.numero_parte || "",
                    isVisible: false
                },
                {
                    type: "Input.Text",
                    id: "cliente",
                    value: productData.cliente || "",
                    isVisible: false
                },

                // Botón Validar — abre hubinn directo en la fila del producto
                {
                    type: "ActionSet",
                    spacing: "Large",
                    actions: [
                        {
                            type: "Action.Submit",
                            title: "✅ Validar producto",
                            data: {
                                intent: "validar_producto"
                            }
                        }
                    ]
                }
            ]
        };

        return container;
    }

    /** Card shown when the AI model fails (rate limit, timeout, etc.) */
    static createErrorCard(sku, errorMessage) {
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
                            type: "Action.Submit",
                            title: "🔄 Reintentar",
                            data: { action: "retry_product_card", sku }
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
        const VALIDATION_URL = "https://innofront-b4htgzhdb2gxe0ga.southcentralus-01.azurewebsites.net/operaciones/validacion/";
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
