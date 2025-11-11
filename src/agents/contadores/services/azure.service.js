import DocumentIntelligence, {
  getLongRunningPoller,
  isUnexpected
} from '@azure-rest/ai-document-intelligence';
import { readFile } from 'fs/promises';
import { logger } from '../../../shared/utils/logger.js';

export class AzureService {
  constructor() {
    this.endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
    this.key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;
    this.modelId = process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL_ID;

    if (!this.endpoint || !this.key || !this.modelId) {
      throw new Error(
        'Azure Document Intelligence configuration missing. ' +
        'Set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT, AZURE_DOCUMENT_INTELLIGENCE_KEY, ' +
        'and AZURE_DOCUMENT_INTELLIGENCE_MODEL_ID environment variables.'
      );
    }

    this.client = DocumentIntelligence(this.endpoint, { key: this.key });
  }

  /**
   * Analiza un documento usando Azure Document Intelligence.
   * 
   * @param {string} filePath - Ruta del archivo a analizar
   * @param {object} options - Opciones de análisis
   * @param {"Model"|"OCR"} options.mode - Modo de análisis ("Model" para modelo personalizado o "OCR" para layout)
   * @returns {Promise<object>} Resultado estructurado del análisis
   */
  async analyzeDocument(filePath, { mode = "Model" } = {}) {
    try {
      const fileBuffer = await readFile(filePath);

      // Seleccionar el modelo según el modo
      const selectedModel =
        mode === "OCR" ? "prebuilt-layout" : this.modelId;

      logger.info(`🔍 Analizando documento en modo: ${mode}`);
      logger.info(`🧠 Modelo seleccionado: ${selectedModel}`);

      // Ejecutar análisis
      const initialResponse = await this.client
        .path("/documentModels/{modelId}:analyze", selectedModel)
        .post({
          contentType: "application/octet-stream",
          body: fileBuffer
        });

      if (isUnexpected(initialResponse)) {
        throw initialResponse.body.error;
      }

      const poller = getLongRunningPoller(this.client, initialResponse);
      const result = await poller.pollUntilDone();
      const analyzeResult = result.body.analyzeResult;

      if (!analyzeResult) {
        throw new Error('No se recibió analyzeResult del servicio de Azure.');
      }

      const modelUsed = analyzeResult.modelId || selectedModel;
      logger.info(`✅ Modelo realmente usado: ${modelUsed}`);

      // Preparar estructura base
      const analysis = {
        mode,
        modelId: modelUsed,
        documents: [],
        pages: [],
        tables: []
      };

      // Si es modo "Model" → solo campos entrenados
      if (mode === "Model") {
        if (analyzeResult.documents?.length) {
          for (const [idx, doc] of analyzeResult.documents.entries()) {
            analysis.documents.push({
              index: idx + 1,
              docType: doc.docType,
              confidence: doc.confidence,
              fields: Object.fromEntries(
                Object.entries(doc.fields || {}).map(([key, val]) => [
                  key,
                  {
                    value: val.valueString ?? val.value ?? null,
                    confidence: val.confidence ?? null
                  }
                ])
              )
            });
          }
        } else {
          logger.warn("⚠️ El modelo no devolvió documentos. Verifica el entrenamiento o formato del PDF.");
        }
      }

      // Si es modo "OCR" → incluir todo (texto, líneas, tablas)
      if (mode === "OCR") {
        if (analyzeResult.pages) {
          for (const page of analyzeResult.pages) {
            analysis.pages.push({
              pageNumber: page.pageNumber,
              lines: page.lines || [],
              words: page.words || [],
              selectionMarks: page.selectionMarks || []
            });
          }
        }

        if (analyzeResult.tables) {
          for (const [i, table] of analyzeResult.tables.entries()) {
            analysis.tables.push({
              index: i + 1,
              boundingRegions: table.boundingRegions || [],
              cells: table.cells || []
            });
          }
        }
      }

      return analysis;

    } catch (error) {
      logger.error('❌ Error analizando documento con Azure', error);
      throw new Error(`Error en análisis Azure: ${error.message}`);
    }
  }

  /**
   * Analiza todos los PDFs dentro de la carpeta "output"
   */
  async analyzeAllPdfsInOutput({ mode = "Model" } = {}) {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const outputDir = path.join('src', 'agents', 'contadores', 'output');

      if (!fs.existsSync(outputDir)) {
        throw new Error('La carpeta de salida no existe');
      }

      const files = fs.readdirSync(outputDir)
        .filter(file => file.toLowerCase().endsWith('.pdf'));

      if (files.length === 0) {
        return { message: 'No hay archivos PDF en la carpeta de salida' };
      }

      const results = [];

      for (const file of files) {
        const filePath = path.join(outputDir, file);
        logger.info(`📄 Analizando archivo: ${file} en modo ${mode}`);

        try {
          const analysis = await this.analyzeDocument(filePath, { mode });
          results.push({ archivo: file, analisis: analysis });
        } catch (error) {
          results.push({ archivo: file, error: error.message });
        }
      }

      return {
        modo: mode,
        totalArchivos: files.length,
        resultados: results
      };

    } catch (error) {
      logger.error('❌ Error analizando PDFs', error);
      throw error;
    }
  }
}
