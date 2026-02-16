import { Constantes } from '../utils/constantes.js';

export class AdaptiveCardService {

    static createProductCard(productData) {

        // Construir opciones del ChoiceSet para Clave SAT
        const choicesSat = Object.entries(Constantes.CodigosClasificacion).map(([key, value]) => ({
            title: `${key} - ${value}`,
            value: key
        }));

        // Construir opciones del ChoiceSet para Marca
        // Formato solicitado: "287-MICROSOFT" (asumimos que el usuario quiere esto como valor también, o al menos como título)
        // El usuario dijo: "ponlo en el mismo campo de marca ejemplo: '287-MICROSOFT'"
        // Usaremos value = "CODIGO" para mantener consistencia con backend, pero Title = "CODIGO - NOMBRE"
        // O si el usuario quiere que el valor final sea "CODIGO-NOMBRE", ajustamos value.
        // Dado que es un sistema de validación, probablemente el backend espere el ID de marca o el Nombre. 
        // Si antes era texto libre, probablemente guardaban el nombre.
        // Voy a poner value = NOMBRE para que sea compatible con lo que había antes (texto), 
        // pero title = "CODIGO - NOMBRE" para la UI.

        // CORRECCIÓN: El usuario pidió "mostrar unidad_medida con el valor de la clave_unidad_sat".
        // Aquí dice "mostrar los dos cuando se de el resultado... ejemplo '287-MICROSOFT'".
        // Si el output JSON debe tener "marca": "287-MICROSOFT", entonces el value debe ser ese.

        const choicesMarca = Object.entries(Constantes.CodigoMarcas).map(([key, value]) => {
            const label = `${key} - ${value}`;
            return {
                title: label,
                value: label // El valor enviado será "287 - MICROSOFT"
            };
        });

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
                    type: "Input.ChoiceSet",
                    id: "clave_producto_servicio_sat",
                    style: "compact",
                    choices: choicesSat,
                    value: defaultSat,
                    placeholder: "Selecciona una clave SAT"
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
                    type: "Input.ChoiceSet",
                    id: "marca", // El ID se mantiene igual
                    style: "compact",
                    choices: choicesMarca,
                    value: defaultMarca,
                    placeholder: "Selecciona una marca"
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

                // SKU Oculto
                {
                    type: "Input.Text",
                    id: "numero_parte",
                    value: productData.numero_parte || "",
                    isVisible: false
                },
                // Cliente Oculto (si existe)
                {
                    type: "Input.Text",
                    id: "cliente",
                    value: productData.cliente || "",
                    isVisible: false
                },

                // Botón Validar
                {
                    type: "ActionSet",
                    spacing: "Large",
                    actions: [
                        {
                            type: "Action.Submit",
                            title: "Validar y Guardar",
                            data: {
                                action: "validate_product"
                            }
                        }
                    ]
                }
            ]
        };

        return container;
    }
}
