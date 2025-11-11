import { PDFDocument } from 'pdf-lib';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { logger } from '../../../shared/utils/logger.js';

export class PdfService {
  static async splitPdfByPages(pdfPath, originalName) {
    try {
      // Leer el archivo PDF
      const pdfBytes = await readFile(pdfPath);

      // Cargar el PDF con pdf-lib
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const totalPages = pdfDoc.getPageCount();

      if (totalPages === 0) {
        throw new Error('El PDF no contiene páginas');
      }

      const splitFiles = [];

      // Crear carpeta de salida si no existe
      const outputDir = path.join('src', 'agents', 'contadores', 'output');
      const fs = await import('fs');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Procesar cada página
      for (let i = 0; i < totalPages; i++) {
        // Crear un nuevo documento PDF
        const newPdf = await PDFDocument.create();

        // Copiar la página específica
        const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
        newPdf.addPage(copiedPage);

        // Guardar el PDF de una página
        const baseName = path.parse(originalName).name;
        const outputFileName = `${baseName}_pagina_${i + 1}.pdf`;
        const outputPath = path.join(outputDir, outputFileName);

        const newPdfBytes = await newPdf.save();
        await writeFile(outputPath, newPdfBytes);

        splitFiles.push({
          nombre: outputFileName,
          ruta: outputPath,
          pagina: i + 1
        });

        logger.info(`Página ${i + 1} guardada`, { outputPath });
      }

      return splitFiles;

    } catch (error) {
      logger.error('Error al dividir PDF', error);
      throw new Error(`Error procesando PDF: ${error.message}`);
    }
  }
}