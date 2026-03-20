import { prisma } from '../../../shared/prisma/client.js';
import { successResponse, errorResponse } from '../../../shared/utils/response.js';
import { logger } from '../../../shared/utils/logger.js';

export class MetricaController {
  static async getByApp(req, res) {
    try {
      const { id } = req.params;
      const metricas = await prisma.catalogo_Metricas.findMany({
        where: { aplicacion_id: parseInt(id) },
        orderBy: { periodo: 'desc' }
      });
      return successResponse(res, metricas);
    } catch (error) {
      logger.error('Error al obtener métricas', error);
      return errorResponse(res, error.message, 500);
    }
  }

  static async create(req, res) {
    try {
      const { id } = req.params;
      const { 
        periodo, usuarios_activos, ejecuciones_por_dia, 
        tiempo_antes_min, tiempo_ahora_min, hito 
      } = req.body;

      // Obtener la configuración vigente al momento
      const config = await prisma.catalogo_Configuraciones.findFirst({
        orderBy: { vigente_desde: 'desc' }
      });

      if (!config) return errorResponse(res, 'No hay una configuración de costo hora vigente', 400);

      const nuevaMetrica = await prisma.catalogo_Metricas.create({
        data: {
          aplicacion_id: parseInt(id),
          configuracion_id: config.id,
          periodo: new Date(periodo),
          usuarios_activos: parseInt(usuarios_activos || 0),
          ejecuciones_por_dia: parseInt(ejecuciones_por_dia || 0),
          tiempo_antes_min: parseFloat(tiempo_antes_min || 0),
          tiempo_ahora_min: parseFloat(tiempo_ahora_min || 0),
          hito
        }
      });

      return successResponse(res, nuevaMetrica, 'Métrica registrada exitosamente', 201);
    } catch (error) {
      logger.error('Error al registrar métrica', error);
      return errorResponse(res, error.message, 500);
    }
  }

  static async update(req, res) {
    try {
      const { id } = req.params;
      const data = req.body;

      // Sanitizar datos numéricos
      if (data.usuarios_activos !== undefined) data.usuarios_activos = parseInt(data.usuarios_activos);
      if (data.ejecuciones_por_dia !== undefined) data.ejecuciones_por_dia = parseInt(data.ejecuciones_por_dia);
      if (data.tiempo_antes_min !== undefined) data.tiempo_antes_min = parseFloat(data.tiempo_antes_min);
      if (data.tiempo_ahora_min !== undefined) data.tiempo_ahora_min = parseFloat(data.tiempo_ahora_min);
      if (data.periodo) data.periodo = new Date(data.periodo);

      const metrica = await prisma.catalogo_Metricas.update({
        where: { id: parseInt(id) },
        data
      });

      return successResponse(res, metrica, 'Métrica actualizada exitosamente');
    } catch (error) {
      logger.error('Error al actualizar métrica', error);
      return errorResponse(res, error.message, 500);
    }
  }
}
