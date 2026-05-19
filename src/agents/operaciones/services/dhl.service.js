/**
 * Servicio de integración para la API de DHL Express (MyDHL API).
 * Gestiona la autenticación Basic Auth y provee métodos para los endpoints
 * principales de Validación, Cotización, Rastreo y Envíos.
 */
export class DhlService {
    /**
     * Inicializa el servicio configurando las credenciales y el entorno.
     * Se recomienda usar variables de entorno para mantener la seguridad.
     */
    constructor() {
        this.username = process.env.DHL_USERNAME;
        this.password = process.env.DHL_PASSWORD;
        this.accountNumber = process.env.DHL_ACCOUNT_NUMBER;
        // Entorno de pruebas por defecto, asegúrate de cambiar a producción cuando estés listo
        this.apiUrl = process.env.DHL_API_URL || "https://express.api.dhl.com/mydhlapi";
        this.version = "3.2.0";    }

    /**
     * Genera los encabezados obligatorios para las peticiones a la API.
     * Convierte las credenciales a formato Base64 para la autenticación Basic.
     * * @private
     * @param {string} [customReference] - Referencia única opcional para la trazabilidad del mensaje.
     * @returns {Object} Objeto con los headers necesarios (Authorization, Message-Reference, etc.).
     */
    _getHeaders(customReference = null) {
        const credentials = Buffer.from(`${this.username}:${this.password}`).toString('base64');
        const messageReference = customReference || `Compucad-Agent-${Date.now()}`;

        return {
            'Authorization': `Basic ${credentials}`,
            'Message-Reference': messageReference,
            'x-version': this.version,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };
    }

    /**
     * Valida si una dirección es apta para servicios de DHL (recolección o entrega).
     * * @param {string} countryCode - Código del país en formato ISO de 2 letras (ej. 'MX', 'US').
     * @param {string} postalCode - Código postal de la ubicación.
     * @param {string} cityName - Nombre de la ciudad.
     * @param {boolean} [strictValidation=false] - Si es true, exige una coincidencia exacta. Si es false, puede devolver sugerencias.
     * @returns {Promise<Object>} JSON con la dirección confirmada o sugerencias.
     * @throws {Error} Si la validación falla o hay un error de red.
     */
    async validateAddress(countryCode, postalCode, cityName, strictValidation = true) {
        const params = new URLSearchParams({
            type: 'pickup',
            countryCode,
            postalCode,
            cityName,
            strictValidation: strictValidation.toString()
        });

        const response = await fetch(`${this.apiUrl}/address-validate?${params}`, {
            method: 'GET',
            headers: this._getHeaders('Validation-Req')
        });

        return this._handleResponse(response);
    }

    /**
     * Obtiene el estado de seguimiento de uno o varios envíos simultáneamente.
     * * @param {string} trackingNumber - El número de guía (AWB) a rastrear.
     * @returns {Promise<Object>} JSON con el historial de eventos y estado actual del paquete.
     * @throws {Error} Si el número no existe o hay problemas de conexión.
     */
    async trackShipment(trackingNumber) {
        const params = new URLSearchParams({ shipmentTrackingNumber: trackingNumber });

        const response = await fetch(`${this.apiUrl}/tracking?${params}`, {
            method: 'GET',
            headers: this._getHeaders(`Track-${trackingNumber}`)
        });

        return this._handleResponse(response);
    }

    /**
     * Obtiene el estado de seguimiento detallado y específico de un único envío.
     * * @param {string} trackingNumber - El número de guía (AWB).
     * @returns {Promise<Object>} JSON con la información de seguimiento detallada.
     * @throws {Error} Si la petición es inválida.
     */
    async trackSingleShipment(trackingNumber) {
        const response = await fetch(`${this.apiUrl}/shipments/${trackingNumber}/tracking`, {
            method: 'GET',
            headers: this._getHeaders(`TrackSingle-${trackingNumber}`)
        });
        
        return this._handleResponse(response);
    }

    /**
     * Cotiza el costo de un envío simple (una sola pieza).
     * * @param {string} originCountry - Código del país de origen (ej. 'MX').
     * @param {string} originCity - Ciudad de origen (ej. 'Zamora').
     * @param {string} destCountry - Código del país de destino.
     * @param {string} destCity - Ciudad de destino.
     * @param {number} weight - Peso del paquete en kilogramos.
     * @param {string} date - Fecha planificada de envío (Formato YYYY-MM-DD).
     * @returns {Promise<Object>} JSON con las diferentes opciones de tarifas y servicios.
     * @throws {Error} Si los parámetros no son válidos o la ruta no está cubierta.
     */
    async getRates(originCountry, originCity, destCountry, destCity, weight, date) {
        const params = new URLSearchParams({
            accountNumber: this.accountNumber,
            originCountryCode: originCountry,
            originCityName: originCity,
            destinationCountryCode: destCountry,
            destinationCityName: destCity,
            weight: weight.toString(),
            length: "10",
            width: "10",
            height: "10",
            plannedShippingDate: date,
            isCustomsDeclarable: "false",
            unitOfMeasurement: "metric"
        });

        const response = await fetch(`${this.apiUrl}/rates?${params}`, {
            method: 'GET',
            headers: this._getHeaders('Rate-Req')
        });

        return this._handleResponse(response);
    }

    /**
     * Cotiza tarifas complejas o de múltiples piezas enviando un payload estructurado.
     * * @param {Object} ratePayload - Objeto JSON completo con los detalles de origen, destino y piezas.
     * @returns {Promise<Object>} JSON con las tarifas cotizadas.
     * @throws {Error} Si el formato del payload no cumple con el esquema de DHL.
     */
    async getMultiPieceRates(ratePayload) {
        const response = await fetch(`${this.apiUrl}/rates`, {
            method: 'POST',
            headers: this._getHeaders('MultiRate-Req'),
            body: JSON.stringify(ratePayload)
        });
        
        return this._handleResponse(response);
    }

    /**
     * Calcula en tiempo real los aranceles, impuestos y cargos aduaneros (Landed Cost).
     * * @param {Object} landedCostPayload - Objeto JSON con los detalles de la mercancía, valores comerciales y HS Codes.
     * @returns {Promise<Object>} JSON con el desglose de impuestos y costos totales.
     * @throws {Error} Si faltan datos aduaneros obligatorios.
     */
    async getLandedCost(landedCostPayload) {
        const response = await fetch(`${this.apiUrl}/landed-cost`, {
            method: 'POST',
            headers: this._getHeaders('LandedCost-Req'),
            body: JSON.stringify(landedCostPayload)
        });
        
        return this._handleResponse(response);
    }

/**
     * Recupera imágenes de documentos de envío (ej. Etiqueta PDF o Factura Comercial).
     * Hace una consulta previa al endpoint de rastreo para obtener el año y mes exacto del envío.
     * * @param {string} trackingNumber - El número de guía del cual se desea el documento.
     * @param {string} [typeCode='INV'] - Tipo de documento ('INV' para Factura, 'AWB' para Etiqueta/Waybill).
     * @returns {Promise<Object>} JSON que contiene el documento codificado en formato Base64.
     */
    async getShipmentImage(trackingNumber, typeCode = 'waybill') { 
        let pickupYearAndMonth;

        try {
            // 1. Consultamos el tracking para extraer la fecha real del envío
            const trackingData = await this.trackSingleShipment(trackingNumber);
            
            // La API puede devolver la data en la raíz del array o dentro de un objeto "shipments"
            const shipment = Array.isArray(trackingData) ? trackingData[0] : trackingData.shipments?.[0];
            
            if (shipment && shipment.shipmentTimestamp) {
                // shipmentTimestamp viene como "2026-05-07T12:45:00"
                // Cortamos los primeros 7 caracteres para obtener "YYYY-MM"
                pickupYearAndMonth = shipment.shipmentTimestamp.substring(0, 7);
            } else {
                throw new Error("No se encontró el timestamp en el tracking");
            }
        } catch (error) {
            console.warn(`[DHL] No se pudo obtener la fecha real para la guía ${trackingNumber}, usando mes actual. Error:`, error.message);
            // Fallback de seguridad: usamos el mes actual si el tracking falla
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            pickupYearAndMonth = `${year}-${month}`;
        }

        // 2. Ahora sí, hacemos la petición de la imagen con el parámetro correcto
        const params = new URLSearchParams({ 
            typeCode,
            pickupYearAndMonth 
        });
        
        const response = await fetch(`${this.apiUrl}/shipments/${trackingNumber}/get-image?${params}`, {
            method: 'GET',
            headers: this._getHeaders(`Img-${trackingNumber}`)
        });
        
        return this._handleResponse(response);
    }

    /**
     * Obtiene el Comprobante de Entrega Electrónico (ePOD) de un envío finalizado.
     * * @param {string} trackingNumber - El número de guía entregado.
     * @returns {Promise<Object>} JSON con los datos de entrega y la firma (usualmente en Base64).
     * @throws {Error} Si el envío aún no ha sido entregado.
     */
    async getProofOfDelivery(trackingNumber) {
        const response = await fetch(`${this.apiUrl}/shipments/${trackingNumber}/proof-of-delivery`, {
            method: 'GET',
            headers: this._getHeaders(`ePOD-${trackingNumber}`)
        });
        
        return this._handleResponse(response);
    }

    /**
     * Consulta los servicios y productos de DHL disponibles para una ruta específica.
     * * @param {string} originCountry - Código del país de origen.
     * @param {string} originCity - Ciudad de origen.
     * @param {string} destCountry - Código del país de destino.
     * @param {string} destCity - Ciudad de destino.
     * @param {number} weight - Peso representativo.
     * @param {string} date - Fecha de envío planificada (YYYY-MM-DD).
     * @returns {Promise<Object>} JSON con la lista de productos aplicables (ej. Express 12:00, Economy Select).
     * @throws {Error} Si no hay cobertura para esa combinación de origen/destino.
     */
    async getProducts(originCountry, originCity, destCountry, destCity, weight, date) {
        const params = new URLSearchParams({
            accountNumber: this.accountNumber,
            originCountryCode: originCountry,
            originCityName: originCity,
            destinationCountryCode: destCountry,
            destinationCityName: destCity,
            weight: weight.toString(),
            plannedShippingDate: date,
            isCustomsDeclarable: "false"
        });

        const response = await fetch(`${this.apiUrl}/products?${params}`, {
            method: 'GET',
            headers: this._getHeaders('Products-Req')
        });
        
        return this._handleResponse(response);
    }

    /**
     * Reserva o genera identificadores (números de guía) de forma anticipada.
     * * @param {string} [type='SID'] - Tipo de identificador ('SID' para Shipment ID).
     * @param {number} [size=1] - Cantidad de identificadores requeridos.
     * @returns {Promise<Object>} JSON con los números de guía reservados.
     * @throws {Error} Si la cuenta no tiene permisos para generar identificadores.
     */
    async getIdentifiers(type = 'SID', size = 1) {
        const params = new URLSearchParams({
            accountNumber: this.accountNumber,
            type,
            size: size.toString()
        });

        const response = await fetch(`${this.apiUrl}/identifiers?${params}`, {
            method: 'GET',
            headers: this._getHeaders('Identifiers-Req')
        });
        
        return this._handleResponse(response);
    }

    /**
     * Procesa la respuesta HTTP centralizando el manejo de errores.
     * Parsea el JSON y extrae los detalles específicos si la API devuelve un error de validación o lógica.
     * * @private
     * @param {Response} response - Objeto Response nativo de la llamada Fetch.
     * @returns {Promise<Object>} Promesa que resuelve al objeto JSON si es exitoso.
     * @throws {Error} Con un mensaje formateado si el status de la respuesta no es OK.
     */
    async _handleResponse(response) {
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`DHL API Error (${response.status}): ${errorData.detail || errorData.title || response.statusText}`);
        }
        return await response.json();
    }
}