import { CierresComentariosService } from '../services/db/cierresComentarios.service.js';
import { successResponse, errorResponse } from '../../../shared/utils/response.js';
import { logger } from '../../../shared/utils/logger.js';

export class CierresComentariosController {
  static async getAll(req, res) {
    try {
      const { clienteNombre, tecnico } = req.query;
      const data = await CierresComentariosService.obtenerTodos({ clienteNombre, tecnico });
      return successResponse(res, data, 'Comentarios obtenidos exitosamente');
    } catch (error) {
      logger.error('Error obteniendo comentarios de cierres', error);
      return errorResponse(res, error.message, 500);
    }
  }

  static async getById(req, res) {
    try {
      const { id } = req.params;
      const data = await CierresComentariosService.obtenerPorId(id);
      if (!data) return errorResponse(res, 'Comentario no encontrado', 404);
      return successResponse(res, data, 'Comentario obtenido exitosamente');
    } catch (error) {
      logger.error('Error obteniendo comentario por id', error);
      return errorResponse(res, error.message, 500);
    }
  }

  static async create(req, res) {
    try {
      const data = await CierresComentariosService.crear(req.body);
      return successResponse(res, data, 'Comentario creado exitosamente', 201);
    } catch (error) {
      logger.error('Error creando comentario de cierre', error);
      return errorResponse(res, error.message, 500);
    }
  }

  static async update(req, res) {
    try {
      const { id } = req.params;
      const existe = await CierresComentariosService.obtenerPorId(id);
      if (!existe) return errorResponse(res, 'Comentario no encontrado', 404);

      const data = await CierresComentariosService.actualizar(id, req.body);
      return successResponse(res, data, 'Comentario actualizado exitosamente');
    } catch (error) {
      logger.error('Error actualizando comentario de cierre', error);
      return errorResponse(res, error.message, 500);
    }
  }

  static async remove(req, res) {
    try {
      const { id } = req.params;
      const existe = await CierresComentariosService.obtenerPorId(id);
      if (!existe) return errorResponse(res, 'Comentario no encontrado', 404);

      await CierresComentariosService.eliminar(id);
      return successResponse(res, null, 'Comentario eliminado exitosamente');
    } catch (error) {
      logger.error('Error eliminando comentario de cierre', error);
      return errorResponse(res, error.message, 500);
    }
  }
}
