import { prisma } from '../../../shared/prisma/client.js';
import { successResponse, errorResponse } from '../../../shared/utils/response.js';
import { logger } from '../../../shared/utils/logger.js';

export class AplicacionController {
  /**
   * Calcula los días hábiles (Lunes a Viernes) entre dos fechas.
   */
  static getDiasLaborales(fechaInicio, fechaFin = new Date()) {
    let count = 0;
    const curDate = new Date(fechaInicio);
    while (curDate <= fechaFin) {
      const dayOfWeek = curDate.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) { // 0: Domingo, 6: Sábado
        count++;
      }
      curDate.setDate(curDate.getDate() + 1);
    }
    return count;
  }

  /**
   * Obtiene todas las aplicaciones con sus métricas calculadas.
   */
  static async getAll(req, res) {
    try {
      const apps = await prisma.catalogo_Aplicaciones.findMany({
        include: {
          metricas: {
            orderBy: { periodo: 'desc' },
            take: 1
          },
          costos: true
        }
      });

      // Obtener la configuración vigente una sola vez para eficiencia
      const configVigente = await prisma.catalogo_Configuraciones.findFirst({
        orderBy: { vigente_desde: 'desc' }
      });

      const costoHora = configVigente ? parseFloat(configVigente.costo_hora) : 0;

      const appsCalculadas = apps.map(app => {
        const latestMetrica = app.metricas[0] || {};
        const dias_laborales = AplicacionController.getDiasLaborales(app.fecha_inicio);
        
        // Los campos de tiempo ahora vienen de la métrica más reciente
        const tiempo_antes = parseFloat(latestMetrica.tiempo_antes_min || 0);
        const tiempo_ahora = parseFloat(latestMetrica.tiempo_ahora_min || 0);
        const ejecuciones = latestMetrica.ejecuciones_por_dia || 0;

        const ahorro_por_ejecucion_min = tiempo_antes - tiempo_ahora;
        const horas_ahorradas = (ahorro_por_ejecucion_min * ejecuciones * dias_laborales) / 60;
        
        const valor_generado = horas_ahorradas * costoHora;
        const costo_total = app.costos.reduce((sum, c) => sum + parseFloat(c.monto), 0);
        const roi = valor_generado - costo_total;
        
        const total_ejecuciones = ejecuciones * dias_laborales;
        const costo_por_ejecucion = total_ejecuciones > 0 ? costo_total / total_ejecuciones : 0;

        return {
          ...app,
          calculos: {
            dias_laborales,
            horas_ahorradas: parseFloat(horas_ahorradas.toFixed(2)),
            valor_generado: parseFloat(valor_generado.toFixed(2)),
            costo_total: parseFloat(costo_total.toFixed(2)),
            roi: parseFloat(roi.toFixed(2)),
            total_ejecuciones: Math.round(total_ejecuciones),
            costo_por_ejecucion: parseFloat(costo_por_ejecucion.toFixed(4))
          }
        };
      });

      return successResponse(res, appsCalculadas);
    } catch (error) {
      logger.error('Error al listar aplicaciones', error);
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * Obtiene el detalle de una aplicación específica.
   */
  static async getById(req, res) {
    try {
      const { id } = req.params;
      const app = await prisma.catalogo_Aplicaciones.findUnique({
        where: { id: parseInt(id) },
        include: {
          metricas: { orderBy: { periodo: 'desc' } },
          costos: { orderBy: { fecha: 'desc' } }
        }
      });

      if (!app) return errorResponse(res, 'Aplicación no encontrada', 404);

      const configVigente = await prisma.catalogo_Configuraciones.findFirst({
        orderBy: { vigente_desde: 'desc' }
      });

      const costoHora = configVigente ? parseFloat(configVigente.costo_hora) : 0;
      const latestMetrica = app.metricas[0] || {};
      const dias_laborales = AplicacionController.getDiasLaborales(app.fecha_inicio);
      
      const tiempo_antes = parseFloat(latestMetrica.tiempo_antes_min || 0);
      const tiempo_ahora = parseFloat(latestMetrica.tiempo_ahora_min || 0);
      const ejecuciones = latestMetrica.ejecuciones_por_dia || 0;

      const ahorro_por_ejecucion_min = tiempo_antes - tiempo_ahora;
      const horas_ahorradas = (ahorro_por_ejecucion_min * ejecuciones * dias_laborales) / 60;
      const valor_generado = horas_ahorradas * costoHora;
      const costo_total = app.costos.reduce((sum, c) => sum + parseFloat(c.monto), 0);
      const roi = valor_generado - costo_total;
      const total_ejecuciones = ejecuciones * dias_laborales;
      const costo_por_ejecucion = total_ejecuciones > 0 ? costo_total / total_ejecuciones : 0;

      const appCalculada = {
        ...app,
        calculos: {
          dias_laborales,
          horas_ahorradas: parseFloat(horas_ahorradas.toFixed(2)),
          valor_generado: parseFloat(valor_generado.toFixed(2)),
          costo_total: parseFloat(costo_total.toFixed(2)),
          roi: parseFloat(roi.toFixed(2)),
          total_ejecuciones: Math.round(total_ejecuciones),
          costo_por_ejecucion: parseFloat(costo_por_ejecucion.toFixed(4))
        }
      };

      return successResponse(res, appCalculada);
    } catch (error) {
      logger.error('Error al obtener detalle de aplicación', error);
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * Crea una nueva aplicación.
   */
  static async create(req, res) {
    try {
      const { 
        nombre, descripcion, tipo, fecha_inicio, 
        tiempo_antes_min, tiempo_ahora_min, ejecuciones_por_dia 
      } = req.body;

      const nuevaApp = await prisma.catalogo_Aplicaciones.create({
        data: {
          nombre,
          descripcion,
          tipo,
          fecha_inicio: new Date(fecha_inicio)
        }
      });

      // Si se enviaron métricas iniciales, registrarlas
      if (tiempo_antes_min !== undefined) {
        const configVigente = await prisma.catalogo_Configuraciones.findFirst({
          orderBy: { vigente_desde: 'desc' }
        });

        await prisma.catalogo_Metricas.create({
          data: {
            aplicacion_id: nuevaApp.id,
            configuracion_id: configVigente?.id || 1, // Fallback si no hay config
            periodo: new Date(),
            tiempo_antes_min: parseFloat(tiempo_antes_min),
            tiempo_ahora_min: parseFloat(tiempo_ahora_min),
            ejecuciones_por_dia: parseInt(ejecuciones_por_dia)
          }
        });
      }

      logger.info('Nueva aplicación IA registrada', nuevaApp);
      return successResponse(res, nuevaApp, 'Aplicación creada exitosamente', 201);
    } catch (error) {
      logger.error('Error al crear aplicación', error);
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * Actualiza los datos de una aplicación.
   */
  static async update(req, res) {
    try {
      const { id } = req.params;
      const data = req.body;

      // Sanitizar datos numéricos si vienen en el body
      if (data.tiempo_antes_min) data.tiempo_antes_min = parseInt(data.tiempo_antes_min);
      if (data.tiempo_ahora_min) data.tiempo_ahora_min = parseInt(data.tiempo_ahora_min);
      if (data.ejecuciones_por_dia) data.ejecuciones_por_dia = parseFloat(data.ejecuciones_por_dia);
      if (data.fecha_inicio) data.fecha_inicio = new Date(data.fecha_inicio);

      const appActualizada = await prisma.catalogo_Aplicaciones.update({
        where: { id: parseInt(id) },
        data
      });

      return successResponse(res, appActualizada, 'Aplicación actualizada exitosamente');
    } catch (error) {
      logger.error('Error al actualizar aplicación', error);
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * Elimina una aplicación.
   */
  static async delete(req, res) {
    try {
      const { id } = req.params;
      
      // Primero eliminar registros relacionados si Prisma no tiene cascada configurada en el schema explícitamente
      // En este caso, el schema que definí no tenía onDelete: Cascade explícito
      await prisma.catalogo_Metricas.deleteMany({ where: { aplicacion_id: parseInt(id) } });
      await prisma.catalogo_Costos.deleteMany({ where: { aplicacion_id: parseInt(id) } });
      
      await prisma.catalogo_Aplicaciones.delete({
        where: { id: parseInt(id) }
      });

      return successResponse(res, null, 'Aplicación eliminada exitosamente');
    } catch (error) {
      logger.error('Error al eliminar aplicación', error);
      return errorResponse(res, error.message, 500);
    }
  }
}
