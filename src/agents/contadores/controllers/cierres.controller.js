import { CierresService } from '../services/db/cierres.service.js';
import { EmailService } from '../services/email.service.js';
import { successResponse, errorResponse } from '../../../shared/utils/response.js';
import { logger } from '../../../shared/utils/logger.js';

export class CierresController {
  static async getAll(req, res) {
    try {
      const { clienteNombre, tecnico } = req.query;
      const data = await CierresService.obtenerTodos({ clienteNombre, tecnico });
      return successResponse(res, data, 'Cierres obtenidos exitosamente');
    } catch (error) {
      logger.error('Error obteniendo cierres', error);
      return errorResponse(res, error.message, 500);
    }
  }

  static async getById(req, res) {
    try {
      const data = await CierresService.obtenerPorId(req.params.id);
      if (!data) return errorResponse(res, 'Cierre no encontrado', 404);
      return successResponse(res, data, 'Cierre obtenido exitosamente');
    } catch (error) {
      logger.error('Error obteniendo cierre por id', error);
      return errorResponse(res, error.message, 500);
    }
  }

  static async cierreFormal(req, res) {
    try {
      const { clienteNombre, comentarioId } = req.body;
      if (!clienteNombre) return errorResponse(res, 'Debe proporcionar clienteNombre', 400);

      const cierres = await CierresService.cierreFormal(clienteNombre, comentarioId);
      EmailService.sendCierreFormal(clienteNombre, cierres);
      return successResponse(res, cierres, `Cierre formal completado: ${cierres.length} técnico(s) procesado(s)`);
    } catch (error) {
      logger.error('Error ejecutando cierre formal', error);
      const status = error.message.includes('Ya existe un cierre') ? 409
        : error.message.includes('No se encontraron') ? 400
        : 500;
      return errorResponse(res, error.message, status);
    }
  }

  static async remove(req, res) {
    try {
      const existe = await CierresService.obtenerPorId(req.params.id);
      if (!existe) return errorResponse(res, 'Cierre no encontrado', 404);
      await CierresService.eliminar(req.params.id);
      return successResponse(res, null, 'Cierre eliminado exitosamente');
    } catch (error) {
      logger.error('Error eliminando cierre', error);
      return errorResponse(res, error.message, 500);
    }
  }
}
