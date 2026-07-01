import { CierreFacturacionService } from '../services/db/cierreFacturacion.service.js';
import { EmailService } from '../services/email.service.js';
import { successResponse, errorResponse } from '../../../shared/utils/response.js';
import { logger } from '../../../shared/utils/logger.js';

export class CierreFacturacionController {
  static async getAll(req, res) {
    try {
      const { clienteNombre, tecnicoResponsable } = req.query;
      const data = await CierreFacturacionService.obtenerTodos({ clienteNombre, tecnicoResponsable });
      return successResponse(res, data, 'Facturaciones obtenidas exitosamente');
    } catch (error) {
      logger.error('Error obteniendo facturaciones', error);
      return errorResponse(res, error.message, 500);
    }
  }

  static async getById(req, res) {
    try {
      const data = await CierreFacturacionService.obtenerPorId(req.params.id);
      if (!data) return errorResponse(res, 'Registro de facturación no encontrado', 404);
      return successResponse(res, data, 'Facturación obtenida exitosamente');
    } catch (error) {
      logger.error('Error obteniendo facturación por id', error);
      return errorResponse(res, error.message, 500);
    }
  }

  static async create(req, res) {
    try {
      const { ClienteNombre, TecnicoResponsable, correoTecnico } = req.body;
      if (!ClienteNombre) return errorResponse(res, 'Debe proporcionar ClienteNombre', 400);

      const data = await CierreFacturacionService.crear({ ClienteNombre, TecnicoResponsable });
      EmailService.sendNotificacionFacturacion(data, correoTecnico);
      return successResponse(res, data, 'Facturación registrada y técnico notificado', 201);
    } catch (error) {
      logger.error('Error registrando facturación', error);
      return errorResponse(res, error.message, 500);
    }
  }

  static async remove(req, res) {
    try {
      const existe = await CierreFacturacionService.obtenerPorId(req.params.id);
      if (!existe) return errorResponse(res, 'Registro de facturación no encontrado', 404);
      await CierreFacturacionService.eliminar(req.params.id);
      return successResponse(res, null, 'Registro de facturación eliminado exitosamente');
    } catch (error) {
      logger.error('Error eliminando registro de facturación', error);
      return errorResponse(res, error.message, 500);
    }
  }
}
