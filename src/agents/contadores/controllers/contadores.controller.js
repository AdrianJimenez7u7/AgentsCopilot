import { PdfService } from '../services/pdf.service.js';
import { AzureService } from '../services/azure.service.js';
import { ReportService } from '../services/report.service.js';
import { EmailService } from '../services/email.service.js';
import { successResponse, errorResponse } from '../../../shared/utils/response.js';
import { logger } from '../../../shared/utils/logger.js';
import multer from 'multer';
import { prisma } from '../../../shared/prisma/client.js';
import { ContadoresService } from '../services/db/contadores.service.js';
import { ClientesService } from '../services/db/clientes.service.js';

// Configurar multer para subida de archivos
const upload = multer({
  dest: 'src/agents/contadores/data/', // Carpeta temporal para uploads
  limits: { fileSize: 16 * 1024 * 1024 } // 16MB límite
});

// 1. Función para generar todas las combinaciones de 0 y O
function getVariations(serial) {
  let results = [serial.toUpperCase()];

  // Iteramos por cada carácter para encontrar los conflictivos
  for (let i = 0; i < serial.length; i++) {
    let char = serial[i].toUpperCase();
    if (char === '0' || char === 'O') {
      let newVariations = [];
      for (let variant of results) {
        // Creamos dos versiones por cada variante existente
        let v0 = variant.substring(0, i) + '0' + variant.substring(i + 1);
        let vO = variant.substring(0, i) + 'O' + variant.substring(i + 1);
        newVariations.push(v0, vO);
      }
      // Eliminamos duplicados usando un Set
      results = [...new Set(newVariations)];
    }
  }
  return results;
}

export class ContadoresController {
  /**
   * Divide un PDF subido en páginas individuales.
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   */
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

  /**
   * Middleware de subida de archivos PDF (multer).
   * @type {import('express').RequestHandler}
   */
  static uploadPdf = upload.any();
  static uploadCsv = upload.single('file');

  /**
   * Limpia la carpeta de salida (output) de PDFs procesados.
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   */
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

  /**
   * Analiza todos los PDFs en la carpeta de salida usando Azure AI.
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   */
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

  /**
   * Procesa un PDF subido: divide, analiza cada página y guarda resultados.
   * @param files
   * @param res
   */
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
          const targetFields = ['Modelo', 'TipoImpresion', 'ip', 'Serie', 'Impresiones', 'ImpresionesColor', 'TipoImpresora'];

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
              extractedData.encontrada = false;
              try {
                const impresionesBN = parseInt(extractedData.Impresiones) || 0;
                const impresionesColor = parseInt(extractedData.ImpresionesColor) || 0;

                let impresoraCliente = await prisma.contadoresInfoClientes.findFirst({
                  where: { Serie: extractedData.Serie }
                });


                // 2. Lógica de validación con Prisma
                let serieInitial = String(extractedData.Serie).toUpperCase();
                let todasLasVariantes = getVariations(serieInitial);

                // Buscamos si alguna de las variantes existe en la BD
                let clienteEncontrado = await prisma.contadoresInfoClientes.findFirst({
                  where: {
                    Serie: {
                      in: todasLasVariantes
                    }
                  }
                });

                if (clienteEncontrado) {
                  console.log("Serie correcta encontrada:", clienteEncontrado.Serie);
                  extractedData.encontrada = true;
                  impresoraCliente = clienteEncontrado;
                } else {
                  console.log("No se encontró ninguna coincidencia.");
                  extractedData.encontrada = false;
                }
                //metodo busqueda fin

                if (impresoraCliente != null) {


                  await prisma.contadores.create({
                    data: {
                      Modelo: extractedData.Modelo || null,
                      TipoImpresion: extractedData.TipoImpresion || null,
                      Ip: extractedData.ip || null,
                      Serie: impresoraCliente.Serie || null,
                      ImpresionesBN: impresionesBN,
                      ImpresionesColor: impresionesColor,
                      TotalImpresiones: impresionesBN + impresionesColor,
                      Cliente: impresoraCliente.Cliente,
                      FechaCaptura: new Date(),
                      TipoImpresora: extractedData.TipoImpresora || null,
                    }
                  });

                  // --- AUTO-INCREMENT FECHA LIMITE REPORTE ---
                  // Reutilizamos impresoraCliente que ya consultamos arriba
                  if (impresoraCliente) {
                    const impresoraInfo = impresoraCliente;


                    if (impresoraInfo) {
                      // 1. Actualizar Contadores Actuales en la tabla InfoClientes
                      // SOLO SI ES MAYOR O IGUAL (Evitar downgrades por reportes viejos)
                      const nuevoTotal = impresionesBN + impresionesColor;
                      const actualTotal = Number(impresoraInfo.ImpresionesActuales) || 0;

                      if (nuevoTotal >= actualTotal) {
                        await prisma.contadoresInfoClientes.update({
                          where: { id: impresoraInfo.id },
                          data: {
                            ImpresionesActuales: nuevoTotal,
                            BN: impresionesBN,
                            Color: impresionesColor
                            // No actualizamos la fecha aqui, esa se actualiza con la logica de abajo si corresponde
                          }
                        });
                        console.log(`Contadores actualizados para ${extractedData.Serie}: ${actualTotal} -> ${nuevoTotal}`);
                      } else {
                        console.warn(`[WARN] Intento de bajar contador para ${extractedData.Serie}. Actual: ${actualTotal}, Nuevo: ${nuevoTotal}. Ignorando update.`);
                      }

                      // 2. Lógica Fecha Límite
                      if (impresoraInfo.FechaLimiteReporte) {
                        const currentDeadline = new Date(impresoraInfo.FechaLimiteReporte);
                        const now = new Date();

                        // Solo actualizar si la fecha limite es pasada o es el mes actual
                        // (evitar doble incremento si se escanea varias veces el mismo mes)
                        // Lógica: Target = Mes Actual + 1.
                        // Si currentDeadline ya es > Fin de Mes Actual, asumimos que ya se actualizó.

                        const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

                        if (currentDeadline < startOfNextMonth) {
                          const originalDay = currentDeadline.getDate();
                          // Calcular siguiente mes
                          const nextDate = new Date(now.getFullYear(), now.getMonth() + 1, originalDay);

                          // Ajuste por si el dia no existe en el siguiente mes (ej. 31 Ene -> 28 Feb)
                          if (nextDate.getDate() !== originalDay) {
                            nextDate.setDate(0); // Ultimo dia del mes anterior (que es el correcto)
                          }

                          await prisma.contadoresInfoClientes.update({
                            where: { id: impresoraInfo.id },
                            data: { FechaLimiteReporte: nextDate }
                          });
                          console.log(`Fecha Limite Actualizada para ${extractedData.Serie}: ${nextDate.toISOString()}`);
                        }
                      }
                    }
                  }
                  // -------------------------------------------

                  completedPages++;
                  console.log(`Página ${pageNumber} completada`);
                } else {
                  console.log(`Página ${pageNumber} sin completar: No se encontró impresora con serie ${extractedData.Serie}`);
                }
              } catch (dbError) {
                console.log(`Página ${pageNumber} sin completar: Error en base de datos`);
                console.error(dbError);
                extractedData.encontrada = false;
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

      // 3. Limpiar carpeta de salida (SOLO archivos de este proceso para evitar colisiones)
      const fsSync = await import('fs');
      for (const splitFile of splitFiles) {
        if (fsSync.existsSync(splitFile.ruta)) {
          fsSync.unlinkSync(splitFile.ruta);
        }
      }

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

  /**
   *  Genera un reporte basado en los parámetros proporcionados.
   * @param {*} req 
   * @param {*} res 
   * @returns 
   */
  static async generateReport(req, res) {
    try {
      // Prioritize body (for POST), fall back to query (for GET)
      const { cliente, mes, anio, estatus, userEmail } = { ...req.query, ...req.body };

      // Support 'ano' or 'anio'
      const year = anio || req.body.ano || req.query.ano;

      if (!cliente && !mes && estatus !== 'null') {
        return errorResponse(res, 'Debe proporcionar al menos uno de los parámetros: cliente, mes, o estatus=null', 400);
      }

      const result = await ReportService.generateReportFromDB({ cliente, mes, anio: year, estatus });

      const emailDestino = userEmail || 'miguel.jimenez@compucad.com.mx';
      const ccEmails = ['miguel.jimenez@compucad.com.mx', 'liliana.martinez@compucad.com.mx'];

      const fs = await import('fs');

      if (estatus === 'null') {
        // Resultado es un array de todos los paths de reportes
        await EmailService.sendReport(emailDestino, result, ccEmails);

        for (const p of result) {
          if (fs.existsSync(p)) {
            fs.unlinkSync(p);
            logger.info(`Reporte eliminado: ${p}`);
          }
        }

        return successResponse(res, {
          reportes: result
        }, 'Reportes generados y enviados exitosamente');
      } else {
        // Resultado es un array de paths
        await EmailService.sendReport(emailDestino, result, ccEmails);

        const paths = Array.isArray(result) ? result : [result];
        for (const p of paths) {
          if (fs.existsSync(p)) {
            fs.unlinkSync(p);
            logger.info(`Reporte eliminado: ${p}`);
          }
        }

        return successResponse(res, {
          reportes: result
        }, 'Reporte generado y enviado exitosamente');
      }

    } catch (error) {
      logger.error('Error generando reporte', error);
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * Limpia la carpeta de salida de forma interna (sin response HTTP).
   */
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

  /**
   * Envía alertas sobre escaneos faltantes.
   * @param {import('express').Request
   * @param {import('express').Response} res
   */
  static async alertarEscaneosFaltantes(req, res) {
    try {
      const alertas = await ContadoresService.alertarEscaneosFaltantes();
      return successResponse(res, alertas, 'Alertas de escaneos faltantes enviadas exitosamente');
    } catch (error) {
      logger.error('Error enviando alertas de escaneos faltantes', error);
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * Envía alertas de escaneos faltantes filtrados por técnico.
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   */
  static async alertarEscaneosFaltantesPorTecnico(req, res) {
    try {
      const { tecnico } = req.params;
      if (!tecnico) {
        return errorResponse(res, 'Debe proporcionar el nombre del técnico', 400);
      }
      const alertas = await ContadoresService.alertarEscaneosFaltantesPorTecnico(tecnico);
      return successResponse(res, alertas, 'Alertas por técnico generadas exitosamente');
    } catch (error) {
      logger.error('Error generando alertas por técnico', error);
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * Obtiene los escaneos faltantes para el cliente.
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   */
  static async escaneosFaltantes(req, res) {
    try {
      const escaneosFaltantes = await ClientesService.obtenerEscaneosFaltantes();
      return successResponse(res, escaneosFaltantes, 'Escaneos faltantes obtenidos exitosamente');
    } catch (error) {
      logger.error('Error obteniendo escaneos faltantes', error);
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * Elimina un cliente por id.
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   */
  static async deleteCliente(req, res) {
    try {
      const id = parseInt(req.params.id);
      const clienteEliminado = await ClientesService.deleteCliente(id);
      return successResponse(res, clienteEliminado, 'Cliente eliminado exitosamente');
    } catch (error) {
      logger.error('Error eliminando cliente', error);
      return errorResponse(res, error.message, 500);
    }
  }

  static async reportesTotalPorMes(req, res) {
    try {
      const { mes, anio } = req.query;
      clietes = await ClientesService.obtenerClientes();
      const reportes = await ReportService.generateReportFromDB(mes, anio);
    } catch (error) {
      logger.error('Error obteniendo reportes totales por mes', error);
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * Valida todos los reportes existentes que tengan el estado nulo.
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   */
  static async validateAllExistReportsStateNull(req, res) {
    try {
      const result = await ContadoresService.validateAllExistReportsStateNull();
      return successResponse(res, result, 'Reportes faltantes validados exitosamente');
    } catch (error) {
      logger.error('Error validando reportes faltantes', error);
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * Obtiene los contadores por fecha.
   * @param {import('express').Request} req
   * @param {import('express').Response} res
   */
  static async obtenerContadoresPorFecha(req, res) {
    try {
      const { fechaInicio, fechaFin } = req.body;
      const contadores = await ContadoresService.obtenerContadoresPorFecha(fechaInicio, fechaFin);
      return successResponse(res, contadores, 'Contadores obtenidos exitosamente');
    } catch (error) {
      logger.error('Error obteniendo contadores por fecha', error);
      return errorResponse(res, error.message, 500);
    }
  }

  static async bulkClientesByCSV(req, res) {
    try {
      if (!req.file) {
        return errorResponse(res, 'No se proporcionó ningún archivo CSV', 400);
      }

      const fs = await import('fs');
      const csvContent = fs.readFileSync(req.file.path, 'utf-8');

      const result = await ClientesService.bulkClientesByCSV(csvContent);

      // Limpiar archivo temporal
      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      return successResponse(res, result, 'Clientes agregados exitosamente');
    } catch (error) {
      logger.error('Error agregando clientes por CSV', error);
      return errorResponse(res, error.message, 500);
    }
  }

  static async getTecnicos(req, res) {
    try {
      const tecnicos = await ClientesService.getTecnicos();
      return successResponse(res, tecnicos, 'Tecnicos obtenidos exitosamente');
    } catch (error) {
      logger.error('Error obteniendo tecnicos', error);
      return errorResponse(res, error.message, 500);
    }
  }

  /**
   * Procesa y registra masivamente un arreglo de escaneos de contadores provenientes de un archivo Excel.
   * Valida la existencia de la máquina en NDD y BD, previene duplicidad de reportes en el mismo día,
   * y ajusta automáticamente la fecha límite del próximo reporte al mes siguiente.
   * 
   * @param {import('express').Request} req - Petición de cliente que incluye el body con la lista `escaneos`.
   * @param {import('express').Response} res - Respuesta de Express para retornar los consolidados (procesados, omitidos, etc).
   * @returns {Promise<void>} Responde directamente la petición HTTP con status y payload.
   */
  static async importarEscaneosExcel(req, res) {
    try {
      const { escaneos } = req.body;

      if (!Array.isArray(escaneos) || escaneos.length === 0) {
        return errorResponse(res, 'No se proporcionó una lista válida de escaneos', 400);
      }

      let procesados = 0;
      let omitidos = 0;
      let errores = 0;
      const detalles = [];

      for (const escaneo of escaneos) {
        try {
          const { serie, impresiones } = escaneo;

          if (!serie) {
            omitidos++;
            detalles.push({ serie: 'Desconocida', error: 'Serie faltante' });
            continue;
          }

          const impresionesNuevas = parseInt(impresiones) || 0;
          let serieInitial = String(serie).toUpperCase().trim();
          let todasLasVariantes = getVariations(serieInitial);

          let impresoraCliente = await prisma.contadoresInfoClientes.findFirst({
            where: {
              Serie: {
                in: todasLasVariantes
              }
            }
          });

          if (!impresoraCliente) {
            omitidos++;
            detalles.push({ serie: serieInitial, error: 'No registrada en BD' });
            continue;
          }

          // Verificar duplicidad para la fecha actual (mismas impresiones, hoy)
          const hoy = new Date();
          const inicioDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
          const finDia = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1);

          const reporteHoy = await prisma.contadores.findFirst({
            where: {
              Serie: impresoraCliente.Serie,
              FechaCaptura: {
                gte: inicioDia,
                lt: finDia
              },
              TotalImpresiones: impresionesNuevas
            }
          });

          if (reporteHoy) {
            omitidos++;
            detalles.push({ serie: impresoraCliente.Serie, error: 'Reporte idéntico ya registrado hoy' });
            continue;
          }

          // Crear registro de contadores históricos (asumimos Excel como Total=BN)
          await prisma.contadores.create({
            data: {
              Modelo: impresoraCliente.Modelo || null,
              Serie: impresoraCliente.Serie,
              ImpresionesBN: impresionesNuevas,
              ImpresionesColor: 0,
              TotalImpresiones: impresionesNuevas,
              Cliente: impresoraCliente.Cliente,
              FechaCaptura: hoy,
              Estatus: null
            }
          });
          console.log({ impresoraCliente });
          // Actualizar ContadoresInfoClientes (Totales actuales)
          const actualTotal = Number(impresoraCliente.ImpresionesActuales) || 0;

          if (impresionesNuevas >= actualTotal) {
            await prisma.contadoresInfoClientes.update({
              where: { id: impresoraCliente.id },
              data: {
                ImpresionesActuales: impresionesNuevas,
                BN: impresionesNuevas,
                Color: 0
              }
            });
          } else {
            logger.warn(`Intento de bajar contador por excel para ${impresoraCliente.Serie}. Actual: ${actualTotal}, Solicitado: ${impresionesNuevas}. Solo guardado en histórico.`);
          }

          // Lógica de salto de Fecha Límite
          if (impresoraCliente.FechaLimiteReporte) {
            const currentDeadline = new Date(impresoraCliente.FechaLimiteReporte);
            const startOfNextMonth = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1);

            if (currentDeadline < startOfNextMonth) {
              const originalDay = currentDeadline.getDate();
              const nextDate = new Date(hoy.getFullYear(), hoy.getMonth() + 1, originalDay);

              // Ajuste por dia bisiesto o meses de 30 días
              if (nextDate.getDate() !== originalDay) {
                nextDate.setDate(0);
              }

              await prisma.contadoresInfoClientes.update({
                where: { id: impresoraCliente.id },
                data: { FechaLimiteReporte: nextDate }
              });
            }
          }

          procesados++;
        } catch (innerError) {
          errores++;
          detalles.push({ serie: escaneo.serie, error: innerError.message });
          logger.error(`Error procesando escaneo para serie ${escaneo.serie}`, innerError);
        }
      }
      console.log({ procesados, omitidos, errores, detalles });
      return successResponse(res, { procesados, omitidos, errores, detalles }, 'Importación por Excel finalizada');

    } catch (error) {
      logger.error('Error en endpoint importarEscaneosExcel', error);
      return errorResponse(res, error.message, 500);
    }
  }
}