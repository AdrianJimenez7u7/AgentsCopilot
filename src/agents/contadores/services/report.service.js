import XLSX from 'xlsx';
import path from 'path';
import { logger } from '../../../shared/utils/logger.js';

export class ReportService {
  static async generateReport(extractedData, originalFileName) {
    try {
      // Categorizar los datos
      const monochromeBW = []; // Equipo monocromatico B/N (solo Impresiones)
      const colorBW = []; // Equipo color B/N (tiene ImpresionesColor pero mostramos solo Impresiones)
      const colorColor = []; // Equipo color Color (ImpresionesColor)

      for (const item of extractedData) {
        if (item.datos && !item.datos.mensaje) {
          const data = item.datos;
          if (data.ImpresionesColor) {
            // Equipo color
            colorBW.push(data); // Para sección B/N de color
            colorColor.push(data); // Para sección Color
          } else if (data.Impresiones) {
            // Equipo monocromatico
            monochromeBW.push(data);
          }
        }
      }

      // Crear workbook
      const wb = XLSX.utils.book_new();

      // Función helper para crear worksheet con datos
      const createDataSheet = (data, sheetName, columns) => {
        if (data.length === 0) return;

        const wsData = [columns]; // Header
        data.forEach(item => {
          const row = columns.map(col => item[col] || '');
          wsData.push(row);
        });

        const ws = XLSX.utils.aoa_to_sheet(wsData);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      };

      // Columnas
      const columns = ['Modelo', 'TipoImpresion', 'ip', 'Serie', 'Impresiones', 'ImpresionesColor'];

      // Crear hojas
      createDataSheet(monochromeBW, 'Mono_BN', columns);
      createDataSheet(colorBW, 'Color_BN', ['Modelo', 'TipoImpresion', 'ip', 'Serie', 'Impresiones']); // Solo Impresiones para B/N
      createDataSheet(colorColor, 'Color_Color', columns);

      // Hoja de Totales
      const totalsData = [
        ['Concepto', 'Cantidad', 'Precio Unitario'],
        ['Total de hojas Blanco y Negro equipo monocromatico', this.sumField(monochromeBW, 'Impresiones'), '$0.18'],
        ['Total de hojas Blanco y Negro equipo monocromatico', this.sumField(monochromeBW, 'Impresiones'), '$0.28'],
        ['Total de hojas impresas Blanco y Negro equipo color', this.sumField(colorBW, 'Impresiones'), '$0.23'],
        ['Total de hojas impresas Color equipo color', this.sumField(colorColor, 'ImpresionesColor'), '$0.95'],
        ['Total de hojas Blanco y Negro equipo monocromatico', this.sumField(monochromeBW, 'Impresiones'), '$0.70'],
        ['Total de hojas impresas Color equipo color', this.sumField(colorColor, 'ImpresionesColor'), '$1.60'],
        ['MONTO FIJO RENTA DE EQUIPO', '1', '$14,375.00']
      ];

      const wsTotals = XLSX.utils.aoa_to_sheet(totalsData);
      XLSX.utils.book_append_sheet(wb, wsTotals, 'Totales');

      // Guardar archivo
      const reportsDir = path.join('src', 'agents', 'contadores', 'Reports');
      const baseName = path.parse(originalFileName).name;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `${baseName}_reporte_${timestamp}.xlsx`;
      const filePath = path.join(reportsDir, fileName);

      XLSX.writeFile(wb, filePath);

      logger.info('Reporte Excel generado', { filePath });

      return filePath;

    } catch (error) {
      logger.error('Error generando reporte', error);
      throw new Error(`Error generando reporte: ${error.message}`);
    }
  }

  static sumField(data, field) {
    return data.reduce((sum, item) => {
      const value = parseInt(item[field]) || 0;
      return sum + value;
    }, 0).toLocaleString(); // Formatear con comas
  }
}