import { PdfService } from '../services/pdf.service.js';
import { AzureService } from '../services/azure.service.js';
import { successResponse, errorResponse } from '../../../shared/utils/response.js';
import { logger } from '../../../shared/utils/logger.js';
import multer from 'multer';

// Configurar multer para subida de archivos
const upload = multer({
  dest: 'src/agents/contadores/data/', // Carpeta temporal para uploads
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB límite
});

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

      logger.info('Procesando PDF completo', { originalName });

      // 1. Dividir el PDF
      const splitFiles = await PdfService.splitPdfByPages(pdfPath, originalName);

      // Limpiar archivo temporal
      const fs = await import('fs');
      if (fs.existsSync(pdfPath)) {
        fs.unlinkSync(pdfPath);
      }

      // 2. Analizar cada página con Azure
      const azureService = new AzureService();
      const results = [];

      for (const splitFile of splitFiles) {
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
            } else {
              extractedData.mensaje = `No estoy entrenado para esa variante de documento: ${splitFile.nombre}`;
            }
          } else {
            extractedData.mensaje = `No estoy entrenado para esa variante de documento: ${splitFile.nombre}`;
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
        }
      }

      // 3. Limpiar carpeta de salida
      await ContadoresController.cleanOutputInternal();

      logger.info('Procesamiento completo', { totalPaginas: splitFiles.length });

      return successResponse(res, {
        totalPaginas: splitFiles.length,
        resultados: results
      }, 'PDF procesado completamente');

    } catch (error) {
      logger.error('Error procesando PDF', error);
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
}