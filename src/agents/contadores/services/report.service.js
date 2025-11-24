import path from 'path';
import ExcelJS from 'exceljs';
import { logger } from '../../../shared/utils/logger.js';
import { PrismaClient } from '@prisma/client';

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

      // Crear workbook con ExcelJS y una sola hoja estilizada
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet('Reporte');

      // Definir anchos de columnas aproximados
      ws.columns = [
        { header: 'Modelo', key: 'Modelo', width: 18 },
        { header: 'Tipo impresión', key: 'TipoImpresion', width: 16 },
        { header: 'IP', key: 'ip', width: 14 },
        { header: 'Número de Serie', key: 'Serie', width: 20 },
        { header: 'Ubicación', key: 'Ubicacion', width: 18 },
        { header: 'Impresiones inicio periodo', key: 'Inicio', width: 14 },
        { header: 'Impresiones fin periodo', key: 'Fin', width: 14 },
        { header: 'No. Hojas Periodo', key: 'Periodo', width: 14 },
        { header: 'Impresiones', key: 'Impresiones', width: 12 },
        { header: 'ImpresionesColor', key: 'ImpresionesColor', width: 16 }
      ];

      // Título principal
      ws.mergeCells('A1:J1');
      const titleCell = ws.getCell('A1');
      titleCell.value = 'REPORTE DE IMPRESIONES';
      titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
      titleCell.font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB15000' } };

      let cursorRow = 3;

      const renderSection = (title, data = [], showColorColumn = false) => {
        // Mostrar siempre el título y el header, aunque no haya datos
        ws.mergeCells(`A${cursorRow}:J${cursorRow}`);
        const secCell = ws.getCell(`A${cursorRow}`);
        secCell.value = title;
        secCell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
        secCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB15000' } };
        secCell.alignment = { horizontal: 'left', vertical: 'middle' };
        cursorRow += 1;

        // Header row
        const headerRow = ws.getRow(cursorRow);
        const headers = ['Modelo', 'Tipo impresión', 'IP', 'Número de Serie', 'Ubicación', 'Impresiones inicio periodo', 'Impresiones fin periodo', 'No. Hojas Periodo', 'Impresiones', 'ImpresionesColor'];
        headers.forEach((h, i) => {
          const cell = headerRow.getCell(i + 1);
          cell.value = h;
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8C3300' } };
          cell.alignment = { horizontal: 'center' };
        });
        headerRow.height = 18;
        cursorRow += 1;

        // Data rows (si existen)
        if (data && data.length > 0) {
          for (const item of data) {
            const row = ws.getRow(cursorRow);
            row.getCell('A').value = item.Modelo || '';
            row.getCell('B').value = item.TipoImpresion || '';
            row.getCell('C').value = item.ip || item.Ip || '';
            row.getCell('D').value = item.Serie || item.Serie || '';
            row.getCell('E').value = item.Ubicacion || '';
            row.getCell('F').value = item.Inicio || '';
            row.getCell('G').value = item.Fin || '';
            const hojasPeriodo = (Number(item.Impresiones) || 0) + (Number(item.ImpresionesColor) || 0);
            row.getCell('H').value = hojasPeriodo || 0;
            row.getCell('I').value = Number(item.Impresiones) || 0;
            row.getCell('J').value = Number(item.ImpresionesColor) || 0;
            cursorRow += 1;
          }
        }

        // Línea total de sección (si no hay datos, mostrará 0)
        const totalRow = ws.getRow(cursorRow);
        totalRow.getCell('A').value = `TOTAL DE IMPRESIONES ${title.toUpperCase()}`;
        totalRow.getCell('A').font = { bold: true };
        const totalImpr = this.sumField(data || [], 'Impresiones');
        const totalImprColor = this.sumField(data || [], 'ImpresionesColor');
        totalRow.getCell('I').value = totalImpr;
        totalRow.getCell('J').value = totalImprColor;
        cursorRow += 2; // espacio
      };

      // Renderizar secciones en la secuencia solicitada (incluye repeticiones)
      renderSection('EQUIPO MONOCROMATICO IMPRESIONES BLANCO Y NEGRO', monochromeBW);
      renderSection('EQUIPO COLOR IMPRESIONES BLANCO Y NEGRO', colorBW);
      renderSection('EQUIPO COLOR IMPRESIONES COLOR', colorColor);
      renderSection('EQUIPO COLOR IMPRESIONES COLOR', colorColor);
      renderSection('EQUIPO COLOR IMPRESIONES BLANCO Y NEGRO', colorBW);
      renderSection('EQUIPO COLOR IMPRESIONES COLOR', colorColor);

      // Totales finales
      ws.mergeCells(`A${cursorRow}:C${cursorRow}`);
      ws.getCell(`A${cursorRow}`).value = 'Totales';
      ws.getCell(`A${cursorRow}`).font = { bold: true };
      cursorRow += 1;

      const totals = [
        { concepto: 'Total de hojas Blanco y Negro equipo monocromatico', cantidad: this.sumField(monochromeBW, 'Impresiones'), precio: 0.18 },
        { concepto: 'Total de hojas Blanco y Negro equipo monocromatico (otro precio)', cantidad: this.sumField(monochromeBW, 'Impresiones'), precio: 0.28 },
        { concepto: 'Total de hojas impresas Blanco y Negro equipo color', cantidad: this.sumField(colorBW, 'Impresiones'), precio: 0.23 },
        { concepto: 'Total de hojas impresas Color equipo color', cantidad: this.sumField(colorColor, 'ImpresionesColor'), precio: 0.95 },
        { concepto: 'MONTO FIJO RENTA DE EQUIPO', cantidad: 1, precio: 14375 }
      ];

      // Encabezados totales
      const totHeader = ws.getRow(cursorRow);
      totHeader.getCell(1).value = 'Concepto';
      totHeader.getCell(2).value = 'Cantidad';
      totHeader.getCell(3).value = 'Precio Unitario';
      totHeader.getCell(4).value = 'Total';
      totHeader.eachCell(cell => { cell.font = { bold: true }; });
      cursorRow += 1;

      let grandTotal = 0;
      for (const t of totals) {
        const r = ws.getRow(cursorRow);
        r.getCell(1).value = t.concepto;
        r.getCell(2).value = t.cantidad;
        r.getCell(3).value = t.precio;
        const lineTotal = (Number(t.cantidad) || 0) * Number(t.precio);
        grandTotal += lineTotal;
        r.getCell(4).value = lineTotal;
        cursorRow += 1;
      }

      // Gran total
      const finalRow = ws.getRow(cursorRow + 1);
      finalRow.getCell(3).value = 'TOTAL';
      finalRow.getCell(3).font = { bold: true };
      finalRow.getCell(4).value = grandTotal;
      finalRow.getCell(4).font = { bold: true };

      // Formato numérico para columnas de cantidad y totales
      for (let r = 1; r <= cursorRow + 1; r++) {
        const row = ws.getRow(r);
        row.getCell(2).numFmt = '#,##0';
        row.getCell(3).numFmt = '$#,##0.00';
        row.getCell(4).numFmt = '$#,##0.00';
      }

      // Guardar archivo
      const reportsDir = path.join('src', 'agents', 'contadores', 'Reports');
      const baseName = path.parse(originalFileName).name;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `${baseName}_reporte_${timestamp}.xlsx`;
      const filePath = path.join(reportsDir, fileName);

      await workbook.xlsx.writeFile(filePath);

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
    }, 0);
  }

  static async generateReportFromDB(params = {}) {
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL
        }
      }
    });
    try {
      if (params.estatus === 'null') {
        // Generar reportes separados por cliente
        const clientsWithNullStatus = await prisma.contadores.findMany({
          where: { Estatus: null },
          select: { Cliente: true },
          distinct: ['Cliente']
        });

        const reportPaths = [];

        for (const clientRecord of clientsWithNullStatus) {
          const client = clientRecord.Cliente;

          const records = await prisma.contadores.findMany({
            where: { Cliente: client, Estatus: null },
            orderBy: { FechaCaptura: 'asc' }
          });

          // Convertir a formato esperado por generateReport
          const extractedData = records.map(record => ({
            datos: {
              Modelo: record.Modelo,
              TipoImpresion: record.TipoImpresion,
              ip: record.Ip,
              Serie: record.Serie,
              Impresiones: record.ImpresionesBN?.toString(),
              ImpresionesColor: record.ImpresionesColor?.toString()
            }
          }));

          // Generar el reporte para este cliente
          const reportPath = await this.generateReport(extractedData, `reporte_${client}_pendiente`);
          reportPaths.push({ cliente: client, reporte: reportPath });

          // Actualizar estatus a "Generados" para este cliente
          await prisma.contadores.updateMany({
            where: { Cliente: client, Estatus: null },
            data: { Estatus: 'Generados' }
          });

          logger.info(`Generado reporte y actualizado estatus para cliente: ${client}`);
        }

        return reportPaths;
      } else {
        // Lógica normal para otros casos
        let whereClause = {};

        if (params.cliente) {
          whereClause.Cliente = params.cliente;
        }

        if (params.mes) {
          // Asumir formato YYYY-MM
          const [year, month] = params.mes.split('-');
          const startDate = new Date(year, month - 1, 1);
          const endDate = new Date(year, month, 1);
          whereClause.FechaCaptura = {
            gte: startDate,
            lt: endDate
          };
        }

        const records = await prisma.contadores.findMany({
          where: whereClause,
          orderBy: params.cliente ? { FechaCaptura: 'desc' } : { FechaCaptura: 'asc' }
        });

        // Convertir a formato esperado por generateReport
        const extractedData = records.map(record => ({
          datos: {
            Modelo: record.Modelo,
            TipoImpresion: record.TipoImpresion,
            ip: record.Ip,
            Serie: record.Serie,
            Impresiones: record.ImpresionesBN?.toString(),
            ImpresionesColor: record.ImpresionesColor?.toString()
          }
        }));

        // Generar el reporte
        const reportPath = await this.generateReport(extractedData, `reporte_${params.cliente || params.mes || 'general'}`);

        return reportPath;
      }

    } catch (error) {
      logger.error('Error generando reporte desde DB', error);
      throw new Error(`Error generando reporte: ${error.message}`);
    } finally {
      await prisma.$disconnect();
    }
  }
}