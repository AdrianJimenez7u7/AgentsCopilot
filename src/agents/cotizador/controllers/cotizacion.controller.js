import { ExcelService } from '../services/excel.service.js';
import { IAService } from '../services/ia.service.js';
import { DocumentService } from '../services/document.service.js';
import { EmailService } from '../services/email.service.js';
import { successResponse, errorResponse } from '../../../shared/utils/response.js';
import { logger } from '../../../shared/utils/logger.js';

export class CotizacionController {
  static async generarCotizacion(req, res) {
    try {
      const { solicitud, cliente } = req.body;

      if (!solicitud) {
        return errorResponse(res, 'Se requiere el campo "solicitud"', 400);
      }

      logger.info('Generando cotización', { solicitud });

      // 1. Leer productos
      const todosProductos = ExcelService.leerTodosLosProductos();

      // 2. Buscar productos relevantes con IA
      const productosSeleccionados = await IAService.buscarProductosRelevantes(
        solicitud, 
        todosProductos
      );

      if (productosSeleccionados.length === 0) {
        return errorResponse(res, 'No se encontraron productos relevantes', 404);
      }

      // 3. Generar documento Word
      const docPath = DocumentService.generarCotizacion(
        productosSeleccionados, 
        cliente || {}
      );

      // 4. Enviar por correo si se proporcionó email
      let correoEnviado = false;
      if (cliente?.email) {
        await EmailService.enviarCotizacion(cliente.email, docPath);
        correoEnviado = true;
      }

      // 5. Preparar resumen
      const resumen = {
        productos: productosSeleccionados.map(p => ({
          nombre: p.nombre,
          precio: p.precio,
          cantidad: p.cantidad || 1
        })),
        totalProductos: productosSeleccionados.length,
        totalCotizacion: productosSeleccionados.reduce(
          (sum, p) => sum + (p.precio * (p.cantidad || 1)), 
          0
        ),
        documentoGenerado: true,
        correoEnviado
      };

      logger.info('Cotización generada exitosamente', resumen);
      
      return successResponse(res, resumen, 'Cotización generada exitosamente');

    } catch (error) {
      logger.error('Error al generar cotización', error);
      return errorResponse(res, error.message, 500);
    }
  }

  static async listarProductos(req, res) {
    try {
      const productos = ExcelService.leerTodosLosProductos();
      return successResponse(res, { productos });
    } catch (error) {
      logger.error('Error al listar productos', error);
      return errorResponse(res, error.message, 500);
    }
  }
}