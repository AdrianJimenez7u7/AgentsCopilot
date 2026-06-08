import { DhlService } from "../services/dhl.service.js";

// Instanciamos el servicio de DHL
const dhlService = new DhlService();

export class DHLcontroller {

    /**
     * @request { countryCode, postalCode, cityName, strictValidation } req.body
     * @returns {Object} Resultado de la validación de dirección
     */
    static async validateAddress(req, res) {
        try {
            const { countryCode, postalCode, cityName, strictValidation } = req.body;
            
            if (!countryCode || !postalCode || !cityName) {
                return res.status(400).json({ error: "countryCode, postalCode y cityName son requeridos" });
            }

            const result = await dhlService.validateAddress(countryCode, postalCode, cityName, strictValidation);
            return res.status(200).json(result);
        } catch (error) {
            console.error(`[DHL] Error en validateAddress:`, error?.message ?? error);
            return res.status(500).json({ status: 500, message: "Error al validar dirección", error: error?.message ?? String(error) });
        }
    }

    /**
     * @request { trackingNumber } req.body
     * @returns {Object} Múltiples eventos de rastreo
     */
    static async trackShipment(req, res) {
        try {
            const { trackingNumber } = req.body;
            
            if (!trackingNumber) {
                return res.status(400).json({ error: "trackingNumber es requerido" });
            }

            const result = await dhlService.trackShipment(trackingNumber);
            return res.status(200).json(result);
        } catch (error) {
            console.error(`[DHL] Error en trackShipment para ${req.body.trackingNumber}:`, error?.message ?? error);
            return res.status(500).json({ status: 500, message: "Error al rastrear envío", error: error?.message ?? String(error) });
        }
    }

    /**
     * @request { trackingNumber } req.body
     * @returns {Object} Eventos detallados de un único envío
     */
    static async trackSingleShipment(req, res) {
        try {
            const { trackingNumber } = req.body;
            
            if (!trackingNumber) {
                return res.status(400).json({ error: "trackingNumber es requerido" });
            }

            const result = await dhlService.trackSingleShipment(trackingNumber);
            return res.status(200).json(result);
        } catch (error) {
            console.error(`[DHL] Error en trackSingleShipment:`, error?.message ?? error);
            return res.status(500).json({ status: 500, message: "Error al rastrear envío único", error: error?.message ?? String(error) });
        }
    }

/**
     * @request { originCountry, originCity, destCountry, destCity, weight, date } req.body
     * @returns {Object} Cotización simple
     */
    static async getRates(req, res) {
        try {
            let { originCountry, originCity, destCountry, destCity, weight, date, dimensionsCm } = req.body;

            if (!originCountry || !originCity || !destCountry || !destCity || !weight || !date) {
                return res.status(400).json({ error: "Faltan parámetros de origen, destino, peso o fecha" });
            }

            // LIMPIEZA DE FECHA: Convierte "2026-05-14T00:00:00.000Z" a "2026-05-14"
            const formattedDate = date.includes('T') ? date.split('T')[0] : date;

            const result = await dhlService.getRates(
                originCountry, 
                originCity, 
                destCountry, 
                destCity, 
                weight, 
                formattedDate,
                dimensionsCm
            );
            return res.status(200).json(result);
        } catch (error) {
            console.error(`[DHL] Error en getRates:`, error?.message ?? error);
            return res.status(500).json({ status: 500, message: "Error al cotizar envío", error: error?.message ?? String(error) });
        }
    }

    /**
     * @request { ratePayload } req.body - JSON completo estructurado
     * @returns {Object} Cotización de múltiples piezas
     */
    static async getMultiPieceRates(req, res) {
        try {
            const ratePayload = req.body;

            if (!ratePayload || Object.keys(ratePayload).length === 0) {
                return res.status(400).json({ error: "El payload de cotización es requerido" });
            }

            const result = await dhlService.getMultiPieceRates(ratePayload);
            return res.status(200).json(result);
        } catch (error) {
            console.error(`[DHL] Error en getMultiPieceRates:`, error?.message ?? error);
            return res.status(500).json({ status: 500, message: "Error al cotizar múltiples piezas", error: error?.message ?? String(error) });
        }
    }

    /**
     * @request { landedCostPayload } req.body - JSON con detalles aduaneros
     * @returns {Object} Costos de aranceles e impuestos
     */
    static async getLandedCost(req, res) {
        try {
            const landedCostPayload = req.body;

            if (!landedCostPayload || Object.keys(landedCostPayload).length === 0) {
                return res.status(400).json({ error: "El payload de landed cost es requerido" });
            }

            const result = await dhlService.getLandedCost(landedCostPayload);
            return res.status(200).json(result);
        } catch (error) {
            console.error(`[DHL] Error en getLandedCost:`, error?.message ?? error);
            return res.status(500).json({ status: 500, message: "Error al calcular landed cost", error: error?.message ?? String(error) });
        }
    }

/**
     * @request { trackingNumber, typeCode (opcional) } req.body
     * @returns {Object} Imagen codificada en Base64
     */
    static async getShipmentImage(req, res) {
        try {
            const { trackingNumber, typeCode } = req.body;

            // Solo exigimos el número de guía
            if (!trackingNumber) {
                return res.status(400).json({ error: "trackingNumber es requerido" });
            }

            // Le pasamos solo el trackingNumber y el typeCode (que puede venir vacío)
            // Si typeCode viene vacío, el DhlService usará 'waybill' por defecto.
            const result = await dhlService.getShipmentImage(trackingNumber, typeCode);
            return res.status(200).json(result);
            
        } catch (error) {
            console.error(`[DHL] Error en getShipmentImage:`, error?.message ?? error);
            return res.status(500).json({ status: 500, message: "Error obteniendo imagen del envío", error: error?.message ?? String(error) });
        }
    }

    /**
     * @request { trackingNumber } req.body
     * @returns {Object} Comprobante electrónico ePOD
     */
    static async getProofOfDelivery(req, res) {
        try {
            const { trackingNumber } = req.body;

            if (!trackingNumber) {
                return res.status(400).json({ error: "trackingNumber es requerido" });
            }

            const result = await dhlService.getProofOfDelivery(trackingNumber);
            return res.status(200).json(result);
        } catch (error) {
            console.error(`[DHL] Error en getProofOfDelivery:`, error?.message ?? error);
            return res.status(500).json({ status: 500, message: "Error obteniendo ePOD", error: error?.message ?? String(error) });
        }
    }

    /**
     * @request { originCountry, originCity, destCountry, destCity, weight, date } req.body
     * @returns {Object} Servicios disponibles para la ruta
     */
    static async getProducts(req, res) {
        try {
            const { originCountry, originCity, destCountry, destCity, weight, date } = req.body;

            if (!originCountry || !originCity || !destCountry || !destCity || !weight || !date) {
                return res.status(400).json({ error: "Faltan parámetros obligatorios de ruta y fecha" });
            }

            const result = await dhlService.getProducts(originCountry, originCity, destCountry, destCity, weight, date);
            return res.status(200).json(result);
        } catch (error) {
            console.error(`[DHL] Error en getProducts:`, error?.message ?? error);
            return res.status(500).json({ status: 500, message: "Error obteniendo productos disponibles", error: error?.message ?? String(error) });
        }
    }

    /**
     * @request { type, size } req.body
     * @returns {Object} Números de guía reservados
     */
    static async getIdentifiers(req, res) {
        try {
            const { type, size } = req.body;

            const result = await dhlService.getIdentifiers(type || 'SID', size || 1);
            return res.status(200).json(result);
        } catch (error) {
            console.error(`[DHL] Error en getIdentifiers:`, error?.message ?? error);
            return res.status(500).json({ status: 500, message: "Error obteniendo identificadores", error: error?.message ?? String(error) });
        }
    }
}