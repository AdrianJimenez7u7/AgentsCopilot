import { prisma } from '../../../shared/prisma/client.js';
import { successResponse, errorResponse } from '../../../shared/utils/response.js';
import { logger } from '../../../shared/utils/logger.js';

export class CostoController {
  static async getByApp(req, res) {
    try {
      const { id } = req.params;
      const costos = await prisma.catalogo_Costos.findMany({
        where: { aplicacion_id: parseInt(id) },
        orderBy: { fecha: 'desc' }
      });
      return successResponse(res, costos);
    } catch (error) {
      logger.error('Error al obtener costos', error);
      return errorResponse(res, error.message, 500);
    }
  }

  static async create(req, res) {
    try {
      const { id } = req.params;
      const { concepto, monto, fecha } = req.body;

      const nuevoCosto = await prisma.catalogo_Costos.create({
        data: {
          aplicacion_id: parseInt(id),
          concepto,
          monto: parseFloat(monto),
          fecha: new Date(fecha)
        }
      });

      return successResponse(res, nuevoCosto, 'Costo registrado exitosamente', 201);
    } catch (error) {
      logger.error('Error al registrar costo', error);
      return errorResponse(res, error.message, 500);
    }
  }

  static async delete(req, res) {
    try {
      const { id } = req.params;
      await prisma.catalogo_Costos.delete({
        where: { id: parseInt(id) }
      });
      return successResponse(res, null, 'Costo eliminado exitosamente');
    } catch (error) {
      logger.error('Error al eliminar costo', error);
      return errorResponse(res, error.message, 500);
    }
  }
}
