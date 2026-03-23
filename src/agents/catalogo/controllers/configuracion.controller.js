import { prisma } from '../../../shared/prisma/client.js';
import { successResponse, errorResponse } from '../../../shared/utils/response.js';
import { logger } from '../../../shared/utils/logger.js';

export class ConfiguracionController {
  /**
   * Obtiene la configuración (costo hora) vigente.
   * Se toma el registro con la fecha 'vigente_desde' más reciente.
   */
  static async getVigente(req, res) {
    try {
      const configuracion = await prisma.catalogo_Configuraciones.findFirst({
        orderBy: {
          vigente_desde: 'desc'
        }
      });

      if (!configuracion) {
        return successResponse(res, null, 'No hay configuraciones registradas');
      }

      return successResponse(res, configuracion);
    } catch (error) {
      logger.error('Error al obtener configuración vigente', error);
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * Registra una nueva configuración de costo hora.
   */
  static async create(req, res) {
    try {
      const { costo_hora, vigente_desde } = req.body;

      if (costo_hora === undefined || costo_hora === null) {
        return errorResponse(res, 'El campo "costo_hora" es obligatorio', 400);
      }

      const nuevaConfig = await prisma.catalogo_Configuraciones.create({
        data: {
          costo_hora: parseFloat(costo_hora),
          vigente_desde: vigente_desde ? new Date(vigente_desde) : new Date()
        }
      });

      logger.info('Nueva configuración de costo hora registrada', nuevaConfig);
      return successResponse(res, nuevaConfig, 'Configuración registrada exitosamente', 201);
    } catch (error) {
      logger.error('Error al registrar configuración', error);
      return errorResponse(res, error.message, 500);
    }
  }
}
