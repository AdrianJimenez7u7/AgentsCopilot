import { PdfService } from '../services/pdf.service.js';
import { AzureService } from '../services/azure.service.js';
import { ReportService } from '../services/report.service.js';
import { EmailService } from '../services/email.service.js';
import { successResponse, errorResponse } from '../../../shared/utils/response.js';
import { logger } from '../../../shared/utils/logger.js';
import multer from 'multer';
import { PrismaClient } from '@prisma/client';
import { ContadoresService } from '../services/db/contadores.service.js';

// Configurar multer para subida de archivos
const upload = multer({
  dest: 'src/agents/contadores/data/', // Carpeta temporal para uploads
  limits: { fileSize: 16 * 1024 * 1024 } // 16MB límite
});

const prisma = new PrismaClient();

export class ContadoresController {
  static async splitPdf(req, res) {
    try {
      console.log('req.files:', req.files);
      console.log('req.body:', req.body);
      // El archivo ya fue procesado por multer en el middleware
      if (!req.files || req.files.length === 0) {
        return errorResponse(res, 'No se proporcionó un archivo PDF', 400);
      }

      const file = req.files[0]; // Tomar el primer archivo
      const pdfPath = file.path;
      const originalName = file.originalname;

      logger.info('Procesando PDF para dividir', { originalName, pdfPath });

      // Dividir el PDF
      const splitFiles = await PdfService.splitPdfByPages(pdfPath, originalName);

      // Limpiar archivo temporal
      const fs = await import('fs');
      if (fs.existsSync(pdfPath)) {
        fs.unlinkSync(pdfPath);
      }

      logger.info('PDF dividido exitosamente', { totalPages: splitFiles.length, files: splitFiles });

      return successResponse(res, {
        mensaje: 'PDF dividido exitosamente',
        totalPaginas: splitFiles.length,
        archivos: splitFiles
      }, 'PDF dividido en páginas individuales');

    } catch (error) {
      logger.error('Error al dividir PDF', error);
      return errorResponse(res, error.message, 500);
    }
  }

  // Middleware para manejar la subida de archivos
  static uploadPdf = upload.any();

  static async cleanOutput(req, res) {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const outputDir = path.join('src', 'agents', 'contadores', 'output');

      if (!fs.existsSync(outputDir)) {
        return successResponse(res, { message: 'La carpeta de salida no existe o ya está vacía' });
      }

      const files = fs.readdirSync(outputDir);
      let deletedCount = 0;

      for (const file of files) {
        const filePath = path.join(outputDir, file);
        if (fs.lstatSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      }

      logger.info(`Eliminados ${deletedCount} archivos de la carpeta de salida`);

      return successResponse(res, {
        message: 'Carpeta de salida limpiada exitosamente',
        archivosEliminados: deletedCount
      });

    } catch (error) {
      logger.error('Error al limpiar carpeta de salida', error);
      return errorResponse(res, error.message, 500);
    }
  }

  static async analyzePdfs(req, res) {
    try {
      const azureService = new AzureService();
      const results = await azureService.analyzeAllPdfsInOutput();

      logger.info('Análisis de PDFs completado', { totalArchivos: results.totalArchivos });

      return successResponse(res, results, 'Análisis de PDFs completado');

    } catch (error) {
      logger.error('Error al analizar PDFs', error);
      return errorResponse(res, error.message, 500);
    }
  }

  static async processPdf(req, res) {
    try {
      // El archivo ya fue procesado por multer
      if (!req.files || req.files.length === 0) {
        return errorResponse(res, 'No se proporcionó un archivo PDF', 400);
      }

      const file = req.files[0];
      const pdfPath = file.path;
      const originalName = file.originalname;

      // Determinar el cliente: usar el campo Cliente del form o el nombre del archivo
      const cliente = req.body.Cliente || originalName.replace(/\.[^/.]+$/, ''); // Remover extensión

      console.log(`Procesando PDF: ${originalName} (Cliente: ${cliente})`);

      // 1. Dividir el PDF
      const splitFiles = await PdfService.splitPdfByPages(pdfPath, originalName);

      console.log(`${splitFiles.length} páginas encontradas`);

      // Limpiar archivo temporal
      const fs = await import('fs');
      if (fs.existsSync(pdfPath)) {
        fs.unlinkSync(pdfPath);
      }

      // 2. Analizar cada página con Azure
      const azureService = new AzureService();
      const results = [];
      let completedPages = 0;

      for (let i = 0; i < splitFiles.length; i++) {
        const splitFile = splitFiles[i];
        const pageNumber = i + 1;
        try {
          const analysis = await azureService.analyzeDocument(splitFile.ruta);

          // Extraer campos específicos
          const extractedData = {};
          const targetFields = ['Modelo', 'TipoImpresion', 'ip', 'Serie', 'Impresiones', 'ImpresionesColor'];

          if (analysis.documents && analysis.documents.length > 0) {
            const fields = analysis.documents[0].fields;

            // Verificar si el campo "Impresiones" existe
            if (fields['Impresiones'] && fields['Impresiones'].value) {
              // Extraer todos los campos
              for (const fieldName of targetFields) {
                if (fields[fieldName] && fields[fieldName].value) {
                  extractedData[fieldName] = fields[fieldName].value;
                }
              }

              // Insertar en la base de datos
              try {
                const impresionesBN = parseInt(extractedData.Impresiones) || 0;
                const impresionesColor = parseInt(extractedData.ImpresionesColor) || 0;

                await prisma.contadores.create({
                  data: {
                    Modelo: extractedData.Modelo || null,
                    TipoImpresion: extractedData.TipoImpresion || null,
                    Ip: extractedData.ip || null,
                    Serie: extractedData.Serie || null,
                    ImpresionesBN: impresionesBN,
                    ImpresionesColor: impresionesColor,
                    TotalImpresiones: impresionesBN + impresionesColor,
                    Cliente: cliente,
                    FechaCaptura: new Date(),
                    // Otros campos opcionales
                  }
                });

                completedPages++;
                console.log(`Página ${pageNumber} completada`);
              } catch (dbError) {
                console.log(`Página ${pageNumber} sin completar: Error en base de datos`);
              }
            } else {
              extractedData.mensaje = `No estoy entrenado para esa variante de documento: ${splitFile.nombre}`;
              console.log(`Página ${pageNumber} sin completar por falta de entrenamiento`);
            }
          } else {
            extractedData.mensaje = `No estoy entrenado para esa variante de documento: ${splitFile.nombre}`;
            console.log(`Página ${pageNumber} sin completar por falta de entrenamiento`);
          }

          results.push({
            pagina: splitFile.nombre,
            datos: extractedData
          });

        } catch (error) {
          results.push({
            pagina: splitFile.nombre,
            error: error.message
          });
          console.log(`Página ${pageNumber} sin completar: ${error.message}`);
        }
      }

      // 3. Limpiar carpeta de salida
      await ContadoresController.cleanOutputInternal();

      console.log(`${completedPages}/${splitFiles.length} páginas completadas`);

      return successResponse(res, {
        totalPaginas: splitFiles.length,
        resultados: results
      }, 'PDF procesado completamente');

    } catch (error) {
      logger.error('Error procesando PDF', error);
      return errorResponse(res, error.message, 500);
    } finally {
      await prisma.$disconnect();
    }
  }

  static async generateReport(req, res) {
    try {
      const { cliente, mes, estatus } = req.query;

      if (!cliente && !mes && estatus !== 'null') {
        return errorResponse(res, 'Debe proporcionar al menos uno de los parámetros: cliente, mes, o estatus=null', 400);
      }

      const result = await ReportService.generateReportFromDB({ cliente, mes, estatus });
      const emailDestino = 'abraham.pardo@compucad.com.mx';

      if (estatus === 'null') {
        // Resultado es un array de reportes por cliente
        // Enviar cada reporte por correo
        for (const item of result) {
          if (item.reporte) {
            await EmailService.sendReport(emailDestino, item.reporte);
          }
        }

        return successResponse(res, {
          reportes: result
        }, 'Reportes generados y enviados exitosamente');
      } else {
        // Resultado es un solo path
        await EmailService.sendReport(emailDestino, result);

        return successResponse(res, {
          reporteExcel: result
        }, 'Reporte generado y enviado exitosamente');
      }

    } catch (error) {
      logger.error('Error generando reporte', error);
      return errorResponse(res, error.message, 500);
    }
  }

  // Método interno para limpiar sin respuesta HTTP
  static async cleanOutputInternal() {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const outputDir = path.join('src', 'agents', 'contadores', 'output');

      if (fs.existsSync(outputDir)) {
        const files = fs.readdirSync(outputDir);
        for (const file of files) {
          const filePath = path.join(outputDir, file);
          if (fs.lstatSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
          }
        }
      }

      logger.info('Carpeta de salida limpiada internamente');

    } catch (error) {
      logger.error('Error limpiando carpeta internamente', error);
    }
  }


  /**
   * Obtiene el catálogo de clientes (ContadoresInfoClientes) ordenado por nombre.
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   */
  static async getClientes(req, res) {
    try {
      const clientes = await ClientesService.obtenerClientes();
      return successResponse(res, clientes, 'Lista de clientes obtenida');
    } catch (error) {
      logger.error('Error obteniendo lista de clientes', error);
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * Obtiene las impresiones/contadores ordenados por fecha de captura descendente.
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   */
  static async getContadores(req, res) {
    try {
      const impresiones = await ClientesService.obtenerContadores();
      return successResponse(res, impresiones, 'Lista de impresiones obtenida');
    } catch (error) {
      logger.error('Error obteniendo lista de impresiones', error);
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * Crea una impresora/cliente en ContadoresInfoClientes.
   * Campos obligatorios: Cliente, Modelo, Serie.
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   */
  static async createImpresoraCliente(req, res) {
    try {
      const data = req.body;
      if (!data.Cliente || !data.Modelo || !data.Serie) {
        return errorResponse(res, 'Faltan campos obligatorios: Cliente, Modelo, Serie', 400);
      }
      const nuevaImpresora = await ClientesService.crearImpresoraCliente(data);
      return successResponse(res, nuevaImpresora, 'Impresora cliente creada exitosamente');
    } catch (error) {
      logger.error('Error creando impresora cliente', error);
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * Actualiza una impresora/cliente existente por id.
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   */
  static async updateImpresoraCliente(req, res) {
    try {
      const id = parseInt(req.params.id);
      const data = req.body;
      const impresoraActualizada = await ClientesService.actualizarImpresoraCliente(id, data);
      return successResponse(res, impresoraActualizada, 'Impresora cliente actualizada exitosamente');
    } catch (error) {
      logger.error('Error actualizando impresora cliente', error);
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * Obtiene los registros con Estatus nulo o vacío (reportes faltantes).
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   */
  static async obtenerReportesFaltantes(req, res) {
    try {
      const reportesFaltantes = await ContadoresService.obtenerReportesFaltantes();
      return successResponse(res, reportesFaltantes, 'Reportes faltantes obtenidos exitosamente');
    } catch (error) {
      logger.error('Error obteniendo reportes faltantes', error);
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * Envía alertas sobre reportes faltantes.
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   */
  static async alertarReportesFaltantes(req, res) {
    try {
      const alertas = await ContadoresService.alertarReportesFaltantes();
      return successResponse(res, alertas, 'Alertas de reportes faltantes enviadas exitosamente');
    } catch (error) {
      logger.error('Error enviando alertas de reportes faltantes', error);
      return errorResponse(res, error.message, 500);
    }
  }
}