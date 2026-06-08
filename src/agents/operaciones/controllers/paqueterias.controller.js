import { response } from "../models/response.js";
import { EnviosService } from "../services/db/envios.service.js";

export class PaqueteriasController {
    static async getPaqueterias(req, res) {
        try {
            const paqueterias = await EnviosService.getPaqueterias();
            return res.status(200).json(new response(200, "Paqueterias obtenidas correctamente", paqueterias));
        }
        catch (error) {
            console.error(`[PaqueteriasController] Error al obtener paqueterias:`, error?.message ?? error);
            return res.status(500).json(new response(500, `Error al obtener paqueterias: ${error?.message ?? String(error)}`));
        }
    }

    static async createCotizacion(req, res) {
        try {
            const cotizacion = await EnviosService.createCotizacion(req.body);
            return res.status(201).json(new response(201, "Cotización creada correctamente", cotizacion));
        }
        catch (error) {
            console.error(`[PaqueteriasController] Error al crear cotización:`, error?.message ?? error);
            return res.status(500).json(new response(500, `Error al crear cotización: ${error?.message ?? String(error)}`));
        }
    }

    static async getCotizacionesByStatus(req, res) {
        try {
            const { status } = req.query;
            if (!status) {
                return PaqueteriasController.getAllCotizaciones(req, res);
            }
            const cotizaciones = await EnviosService.getCotizacionesByStatus(status);
            return res.status(200).json(new response(200, "Cotizaciones obtenidas correctamente", cotizaciones));
        }
        catch (error) {
            console.error(`[PaqueteriasController] Error al obtener cotizaciones por status:`, error?.message ?? error);
            return res.status(500).json(new response(500, `Error al obtener cotizaciones por status: ${error?.message ?? String(error)}`));
        }
    }

    static async autorizarCotizacion(req, res) {
        try {
            const { id } = req.body;
            const { userAutorizer } = req.body;
            if (!id || !userAutorizer) {
                return res.status(400).json(new response(400, "Los campos 'id' y 'userAutorizer' son requeridos"));
            }

            const cotizacion = await EnviosService.autorizarCotizacion(id, userAutorizer);
            return res.status(200).json(new response(200, "Cotización autorizada correctamente", cotizacion));
        }
        catch (error) {
            console.error(`[PaqueteriasController] Error al autorizar cotización:`, error?.message ?? error);
            return res.status(500).json(new response(500, `Error al autorizar cotización: ${error?.message ?? String(error)}`));
        }
    }

    static async rechazarCotizacion(req, res) {
        try {
            const { id } = req.body;
            const { userAutorizer } = req.body;
            const { motivoRechazo } = req.body;
             if (!id || !userAutorizer || !motivoRechazo) {
                return res.status(400).json(new response(400, "Los campos 'id', 'userAutorizer' y 'motivoRechazo' son requeridos"));
            }

            const cotizacion = await EnviosService.rechazarCotizacion(id, userAutorizer, motivoRechazo);
            return res.status(200).json(new response(200, "Cotización rechazada correctamente", cotizacion));
        }
        catch (error) {
            console.error(`[PaqueteriasController] Error al rechazar cotización:`, error?.message ?? error);
            return res.status(500).json(new response(500, `Error al rechazar cotización: ${error?.message ?? String(error)}`));
        }
    }

    static async getAllEnvios(req, res) {
        try {
            const envios = await EnviosService.getAllEnvios();
            return res.status(200).json(new response(200, "Envíos obtenidos correctamente", envios));
        }
        catch (error) {
            console.error(`[PaqueteriasController] Error al obtener envíos:`, error?.message ?? error);
            return res.status(500).json(new response(500, `Error al obtener envíos: ${error?.message ?? String(error)}`));
        }
    }

    static async getAllCotizaciones(req, res) {
        try {
            const cotizaciones = await EnviosService.getAllCotizaciones();
            return res.status(200).json(new response(200, "Cotizaciones obtenidas correctamente", cotizaciones));
        }
        catch (error) {
            console.error(`[PaqueteriasController] Error al obtener cotizaciones:`, error?.message ?? error);
            return res.status(500).json(new response(500, `Error al obtener cotizaciones: ${error?.message ?? String(error)}`));
        }
    }

    static async addGuiaToEnvio(req, res) {
        try {
            const { idEnvio } = req.body;
            const { numeroGuia } = req.body;
            if (!idEnvio || !numeroGuia) {
                return res.status(400).json(new response(400, "Los campos 'idEnvio' y 'numeroGuia' son requeridos"));
            }
            const guia = await EnviosService.vincularGuiaAEnvio(idEnvio, numeroGuia);
            return res.status(200).json(new response(200, "Guía vinculada al envío correctamente", guia));
        }
        catch (error) {
            console.error(`[PaqueteriasController] Error al vincular guía a envío:`, error?.message ?? error);
            return res.status(500).json(new response(500, `Error al vincular guía a envío: ${error?.message ?? String(error)}`));
        }
    }

    static async updateEnvio(req, res) {
        try {
            const { idEnvio } = req.params;
            const { updateData } = req.body;
            if (!idEnvio || !updateData) {
                return res.status(400).json(new response(400, "Los campos 'idEnvio' y 'updateData' son requeridos"));
            }
            const envio = await EnviosService.updateEnvio(idEnvio, updateData);
            return res.status(200).json(new response(200, "Envío actualizado correctamente", envio));
        }
        catch (error) {
            console.error(`[PaqueteriasController] Error al actualizar envío:`, error?.message ?? error);
            return res.status(500).json(new response(500, `Error al actualizar envío: ${error?.message ?? String(error)}`));
        }
    }

}