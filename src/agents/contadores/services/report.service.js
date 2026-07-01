import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';
import { logger } from '../../../shared/utils/logger.js';
import { prisma } from '../../../shared/prisma/client.js';
import axios from 'axios';
import { PdfReportService } from './pdf.report.service.js';


export class ReportService {
  static filterUniqueSerieByMaxId(registros) {
    const map = new Map();
    for (const r of registros) {
      const existing = map.get(r.Serie);
      if (!existing) {
        map.set(r.Serie, r);
      } else {
        // Prefer the one with Estatus != null
        const existingHasStatus = existing.Estatus != null;
        const currentHasStatus = r.Estatus != null;
        if (currentHasStatus && !existingHasStatus) {
          map.set(r.Serie, r);
        } else if (!currentHasStatus && !existingHasStatus) {
          // Both null, take higher id (most recent)
          if ((r.id || 0) > (existing.id || 0)) {
            map.set(r.Serie, r);
          }
        } else if (currentHasStatus && existingHasStatus) {
          // Both have status, take higher id (most recent)
          if ((r.id || 0) > (existing.id || 0)) {
            map.set(r.Serie, r);
          }
        }
        // If existing has status and current doesn't, keep existing
      }
    }
    return Array.from(map.values());
  }

  static async fetchImage(url) {
    try {
      const response = await axios.get(url, { responseType: 'arraybuffer' });
      return Buffer.from(response.data, 'binary');
    } catch (error) {
      logger.error('Error fetching image', error);
      return null;
    }
  }

  static async generateReport(extractedData, originalFileName, headerData = {}) {
    try {
      // Categorizar los datos
      const monochromePrinters = [];
      const colorPrinters = [];

      for (const item of extractedData) {
        if (item.datos && !item.datos.mensaje) {
          const data = item.datos;
          const tipo = (data.TipoImpresora || '').toLowerCase();
          const isColor = tipo.includes('color');

          if (isColor) {
            colorPrinters.push(data);
          } else {
            monochromePrinters.push(data);
          }
        }
      }

      const monochromeBW = monochromePrinters.map(d => ({ ...d, ImpresionesColor: 0 }));
      const colorBW = colorPrinters.map(d => ({ ...d, ImpresionesColor: 0 }));
      const colorColor = colorPrinters.map(d => ({ ...d, Impresiones: 0 }));

      // Crear workbook
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet('Reporte');

      // Definir columnas
      ws.columns = [
        { key: 'Modelo', width: 18 },
        { key: 'TipoImpresion', width: 16 },
        { key: 'ip', width: 14 },
        { key: 'Serie', width: 20 },
        { key: 'Ubicacion', width: 18 },
        { key: 'FechaInicio', width: 16 },
        { key: 'Inicio', width: 16 },
        { key: 'FechaFin', width: 16 },
        { key: 'Fin', width: 16 },
        { key: 'Hojas', width: 16 }
      ];

      // Logo - Ocupa A1:B1, tamaño reducido
      const logoUrl = 'https://compucad.com.mx/wp-content/uploads/2024/05/compucad-logotipo-2024-copy.png';
      const logoBuffer = await this.fetchImage(logoUrl);
      if (logoBuffer) {
        const imageId = workbook.addImage({
          buffer: logoBuffer,
          extension: 'png',
        });
        ws.addImage(imageId, {
          tl: { col: 0, row: 0 },
          br: { col: 1, row: 1 },
          ext: { width: 120, height: 60 } // Tamaño reducido al 40%
        });
      }

      // Ajustar altura de las filas del header
      ws.getRow(2).height = 25;
      ws.getRow(3).height = 25;

      // Header personalizado - Fila 2
      ws.mergeCells('C2:D2');
      ws.getCell('C2').value = `Cliente: ${headerData.cliente || ''}`;
      ws.getCell('C2').font = { bold: true, size: 11, color: { argb: 'FF000000' } };
      ws.getCell('C2').alignment = { vertical: 'middle', horizontal: 'left' };
      ws.getCell('C2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };

      ws.mergeCells('E2:H2');
      ws.getCell('E2').value = `Periodo: ${headerData.inicio || ''} - ${headerData.fin || ''}`;
      ws.getCell('E2').font = { bold: true, size: 11, color: { argb: 'FF000000' } };
      ws.getCell('E2').alignment = { vertical: 'middle', horizontal: 'center' };
      ws.getCell('E2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };

      ws.mergeCells('I2:J2');
      ws.getCell('I2').value = `Mes: ${headerData.mes || ''}`;
      ws.getCell('I2').font = { bold: true, size: 11, color: { argb: 'FF000000' } };
      ws.getCell('I2').alignment = { vertical: 'middle', horizontal: 'center' };
      ws.getCell('I2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };

      // Aplicar bordes
      const headerBorder = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } }
      };
      ws.getCell('C2').border = headerBorder;
      ws.getCell('E2').border = headerBorder;
      ws.getCell('I2').border = headerBorder;

      // Título principal
      let cursorRow = 4;
      ws.mergeCells(`A${cursorRow}:J${cursorRow}`);
      const titleCell = ws.getCell(`A${cursorRow}`);
      titleCell.value = 'REPORTE DE IMPRESIONES';
      titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
      titleCell.font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB15000' } };
      ws.getRow(cursorRow).height = 30;
      cursorRow++;

      const formatDate = (d) => {
        if (!d) return '';
        const date = new Date(d);
        const dd = String(date.getDate()).padStart(2, '0');
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const yyyy = date.getFullYear();
        return `${dd}/${mm}/${yyyy}`;
      };

      const renderSection = (title, data = []) => {
        ws.mergeCells(`A${cursorRow}:J${cursorRow}`);
        const secCell = ws.getCell(`A${cursorRow}`);
        secCell.value = title;
        secCell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
        secCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB15000' } };
        secCell.alignment = { horizontal: 'left', vertical: 'middle' };
        cursorRow++;

        const headerRow = ws.getRow(cursorRow);

        const esBN = title.includes('BLANCO Y NEGRO');
        const esColor = title.includes('COLOR') && !title.includes('BLANCO');

        const headers = [
          'Modelo',
          'Tipo impresión',
          'IP',
          'Número de Serie',
          'Ubicación',
          'Fecha Inicio',
          esBN ? 'Inicio BN' : 'Inicio Color',
          'Fecha Fin',
          esBN ? 'Fin BN' : 'Fin Color',
          esBN ? 'Impresiones BN' : 'Impresiones Color'
        ];

        headers.forEach((h, i) => {
          const cell = headerRow.getCell(i + 1);
          cell.value = h;
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8C3300' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });
        cursorRow++;

        if (data && data.length > 0) {
          for (const item of data) {
            const row = ws.getRow(cursorRow);
            row.getCell(1).value = item.Modelo || '';
            row.getCell(2).value = item.TipoImpresion || '';
            row.getCell(3).value = item.ip || item.Ip || '';
            row.getCell(4).value = item.Serie || '';
            row.getCell(5).value = item.Ubicacion || '';
            row.getCell(6).value = formatDate(item.FechaInicio);
            row.getCell(8).value = formatDate(item.FechaFin);

            if (esBN) {
              row.getCell(7).value = Number(item.InicioBN) || 0;
              row.getCell(9).value = Number(item.FinBN) || 0;
              row.getCell(10).value = Number(item.Impresiones) || 0;
            } else if (esColor) {
              row.getCell(7).value = Number(item.InicioColor) || 0;
              row.getCell(9).value = Number(item.FinColor) || 0;
              row.getCell(10).value = Number(item.ImpresionesColor) || 0;
            }

            cursorRow++;
          }
        }

        // Total row
        const totalRow = ws.getRow(cursorRow);
        ws.mergeCells(cursorRow, 1, cursorRow, 9);
        totalRow.getCell(1).value = `TOTAL DE IMPRESIONES ${title.toUpperCase()}`;
        totalRow.getCell(1).font = { bold: true };
        totalRow.getCell(1).alignment = { horizontal: 'right' };

        const total = esBN ? this.sumField(data || [], 'Impresiones') : this.sumField(data || [], 'ImpresionesColor');
        totalRow.getCell(10).value = total;
        totalRow.getCell(10).font = { bold: true };
        cursorRow += 2;
      };

      renderSection('EQUIPO MONOCROMATICO IMPRESIONES BLANCO Y NEGRO', monochromeBW);
      renderSection('EQUIPO COLOR IMPRESIONES BLANCO Y NEGRO', colorBW);
      renderSection('EQUIPO COLOR IMPRESIONES COLOR', colorColor);

      // Totales finales
      ws.mergeCells(`A${cursorRow}:J${cursorRow}`);
      ws.getCell(`A${cursorRow}`).value = 'Totales';
      ws.getCell(`A${cursorRow}`).font = { bold: true };
      cursorRow++;

      // Consultar precios del cliente
      // Consultar precios del cliente
      // Usamos la instancia global de Prisma

      let clientRecords = [];
      let precioBN = 0.18;
      let precioColor = 0.95;
      try {
        clientRecords = await prisma.contadoresInfoClientes.findMany({
          where: { Cliente: headerData.cliente },
          select: {
            Modelo: true,
            Serie: true,
            PrecioBN: true,
            PrecioColor: true,
            RentaFija: true
          }
        });
        if (clientRecords.length > 0) {
          // Tomar precios del primer registro (todos los equipos tienen los mismos precios de impresión)
          precioBN = clientRecords[0].PrecioBN ? clientRecords[0].PrecioBN.toNumber() : 0.18;
          precioColor = clientRecords[0].PrecioColor ? clientRecords[0].PrecioColor.toNumber() : 0.95;
        }
      } catch (error) {
        logger.error('Error consultando precios del cliente', error);
      } finally {
        // No desconectamos la instancia global
      }

      const totals = [
        { concepto: 'Total de hojas Blanco y Negro equipo monocromatico', cantidad: this.sumField(monochromeBW, 'Impresiones'), precio: precioBN },
        { concepto: 'Total de hojas Blanco y Negro equipo monocromatico (otro precio)', cantidad: this.sumField(monochromeBW, 'Impresiones'), precio: precioBN },
        { concepto: 'Total de hojas impresas Blanco y Negro equipo color', cantidad: this.sumField(colorBW, 'Impresiones'), precio: precioBN },
        { concepto: 'Total de hojas impresas Color equipo color', cantidad: this.sumField(colorColor, 'ImpresionesColor'), precio: precioColor }
      ];

      // Agregar rentas fijas por equipo
      clientRecords.forEach(record => {
        if (record.RentaFija) {
          totals.push({
            concepto: `Renta Equipo ${record.Modelo || 'N/A'} (${record.Serie || 'N/A'})`,
            cantidad: 1,
            precio: record.RentaFija.toNumber()
          });
        }
      });

      const totHeader = ws.getRow(cursorRow);
      totHeader.getCell(1).value = 'Concepto';
      totHeader.getCell(2).value = 'Cantidad';
      totHeader.getCell(3).value = 'Precio Unitario';
      totHeader.getCell(4).value = 'Total';
      totHeader.eachCell(cell => { cell.font = { bold: true }; });
      cursorRow++;

      let grandTotal = 0;
      for (const t of totals) {
        const r = ws.getRow(cursorRow);
        r.getCell(1).value = t.concepto;
        r.getCell(2).value = t.cantidad;
        r.getCell(3).value = t.precio;
        const lineTotal = (Number(t.cantidad) || 0) * Number(t.precio);
        grandTotal += lineTotal;
        r.getCell(4).value = lineTotal;
        cursorRow++;
      }

      const finalRow = ws.getRow(cursorRow + 1);
      finalRow.getCell(3).value = 'TOTAL';
      finalRow.getCell(3).font = { bold: true };
      finalRow.getCell(4).value = grandTotal;
      finalRow.getCell(4).font = { bold: true };

      // Formatting
      for (let r = 1; r <= cursorRow + 1; r++) {
        const row = ws.getRow(r);
        if (r > 4) {
          row.getCell(2).numFmt = '#,##0';
          row.getCell(3).numFmt = '$#,##0.00';
          row.getCell(4).numFmt = '$#,##0.00';
        }
      }

      const reportsDir = path.join('src', 'agents', 'contadores', 'Reports');
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }
      const baseName = path.parse(originalFileName).name;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `${baseName}_reporte_${timestamp}.xlsx`;
      const filePath = path.join(reportsDir, fileName);

      await workbook.xlsx.writeFile(filePath);
      logger.info('Reporte Excel generado', { filePath });
      return filePath;
    } catch (error) {
      logger.error('Error generando reporte Excel', error);
      throw error;
    }
  }


  static sumField(data, field) {
    return data.reduce((sum, item) => {
      const value = parseInt(item[field]) || 0;
      return sum + value;
    }, 0);
  }

  static async generateReportFromDB(params = {}) {
    // Usamos la instancia global de prisma, no creamos una nueva

    try {
      const getHeaderData = (cliente, dateStr) => {
        let inicio = '', fin = '', mes = '';
        if (dateStr) {
          const [year, month] = dateStr.split('-');
          const date = new Date(year, month - 1, 1);
          const lastDay = new Date(year, month, 0);
          inicio = `01/${month}/${year}`;
          fin = `${lastDay.getDate()}/${month}/${year}`;
          mes = date.toLocaleString('es-ES', { month: 'long' }).toUpperCase();
        }
        return { cliente, inicio, fin, mes };
      };

      if (params.estatus === 'null') {
        const clientes = await prisma.contadores.findMany({
          where: { Estatus: null },
          select: { Cliente: true },
          distinct: ['Cliente']
        });

        const allReports = [];
        for (const c of clientes) {
          let registros = await prisma.contadores.findMany({
            where: {
              Cliente: c.Cliente,
              Estatus: null
            }
          });

          // Filtrar para tomar solo el registro con id más alto por Serie
          registros = this.filterUniqueSerieByMaxId(registros);

          if (registros.length > 0) {
            const extractedData = await Promise.all(registros.map(async (r) => {
              // Buscar el escaneo inmediatamente anterior para calcular el delta del periodo
              const registroAnterior = await prisma.contadores.findFirst({
                where: {
                  Serie: r.Serie,
                  id: { lt: r.id }
                },
                orderBy: { id: 'desc' }
              });

              const bnActual = r.ImpresionesBN || 0;
              const colorActual = r.ImpresionesColor || 0;
              const bnAnterior = registroAnterior?.ImpresionesBN || 0;
              const colorAnterior = registroAnterior?.ImpresionesColor || 0;

              const diferenciasBN = Math.max(0, bnActual - bnAnterior);
              const diferenciasColor = Math.max(0, colorActual - colorAnterior);

              // LOG DE DEPURACIÓN
              logger.info(`[DEBUG] Serie: ${r.Serie} | Cliente: ${c.Cliente}`);
              logger.info(`[DEBUG] B/N: ${bnAnterior} -> ${bnActual} (diff: ${diferenciasBN})`);
              logger.info(`[DEBUG] Color: ${colorAnterior} -> ${colorActual} (diff: ${diferenciasColor})`);
              logger.info(`[DEBUG] Registro anterior encontrado: ${registroAnterior ? 'SÍ (ID: ' + registroAnterior.id + ')' : 'NO'}`);

              return {
                datos: {
                  Modelo: r.Modelo,
                  TipoImpresion: r.TipoImpresion,
                  ip: r.Ip,
                  Serie: r.Serie,
                  Ubicacion: r.Adicional2,
                  InicioBN: bnAnterior,
                  FinBN: bnActual,
                  Impresiones: diferenciasBN,
                  InicioColor: colorAnterior,
                  FinColor: colorActual,
                  ImpresionesColor: diferenciasColor,
                  TipoImpresora: r.TipoImpresora,
                  FechaInicio: registroAnterior?.FechaCaptura || null,
                  FechaFin: r.FechaCaptura || null
                }
              };
            }));

            const firstDate = registros[0].FechaCaptura ? new Date(registros[0].FechaCaptura).toISOString().slice(0, 7) : params.mes;
            const headerData = getHeaderData(c.Cliente, firstDate);

            const excelPath = await this.generateReport(extractedData, `Reporte_${c.Cliente}`, headerData);
            const pdfPath = await PdfReportService.generatePdfReport(extractedData, `Reporte_${c.Cliente}`, headerData);

            allReports.push(excelPath, pdfPath);

            if (!params.dryRun) {

              await prisma.contadores.updateMany({
                where: {
                  Cliente: c.Cliente,
                  Estatus: null
                },
                data: { Estatus: 'Reportado' }
              });
            }
          }
        }
        return allReports;
      } else {
        const where = {};
        if (params.cliente) where.Cliente = params.cliente;
        if (params.mes && params.anio) {
          const month = parseInt(params.mes);
          const year = parseInt(params.anio);
          where.FechaCaptura = {
            gte: new Date(year, month - 1, 1),
            lt: new Date(year, month, 1)
          };
        }

        let registros = await prisma.contadores.findMany({ where });

        // Filtrar para tomar solo el registro con id más alto por Serie
        registros = this.filterUniqueSerieByMaxId(registros);

        const extractedData = await Promise.all(registros.map(async (r) => {
          // Buscar el escaneo inmediatamente anterior para calcular el delta del periodo
          const registroAnterior = await prisma.contadores.findFirst({
            where: {
              Serie: r.Serie,
              id: { lt: r.id }
            },
            orderBy: { id: 'desc' }
          });

          const bnActual = r.ImpresionesBN || 0;
          const colorActual = r.ImpresionesColor || 0;
          const bnAnterior = registroAnterior?.ImpresionesBN || 0;
          const colorAnterior = registroAnterior?.ImpresionesColor || 0;

          const diferenciasBN = Math.max(0, bnActual - bnAnterior);
          const diferenciasColor = Math.max(0, colorActual - colorAnterior);

          // LOG DE DEPURACIÓN
          logger.info(`[DEBUG] Serie: ${r.Serie} | Cliente: ${r.Cliente}`);
          logger.info(`[DEBUG] B/N: ${bnAnterior} -> ${bnActual} (diff: ${diferenciasBN})`);
          logger.info(`[DEBUG] Color: ${colorAnterior} -> ${colorActual} (diff: ${diferenciasColor})`);
          logger.info(`[DEBUG] Registro anterior encontrado: ${registroAnterior ? 'SÍ (ID: ' + registroAnterior.id + ')' : 'NO'}`);

          return {
            datos: {
              Modelo: r.Modelo,
              TipoImpresion: r.TipoImpresion,
              ip: r.Ip,
              Serie: r.Serie,
              Ubicacion: r.Adicional2,
              InicioBN: bnAnterior,
              FinBN: bnActual,
              Impresiones: diferenciasBN,
              InicioColor: colorAnterior,
              FinColor: colorActual,
              ImpresionesColor: diferenciasColor,
              TipoImpresora: r.TipoImpresora,
              FechaInicio: registroAnterior?.FechaCaptura || null,
              FechaFin: r.FechaCaptura || null
            }
          };
        }));

        let firstDate = '';
        if (registros.length > 0 && registros[0].FechaCaptura) {
          firstDate = new Date(registros[0].FechaCaptura).toISOString().slice(0, 7);
        } else if (params.anio && params.mes) {
          // Construct YYYY-MM from params if no records
          const m = params.mes.toString().padStart(2, '0');
          firstDate = `${params.anio}-${m}`;
        }

        const headerData = getHeaderData(params.cliente || 'General', firstDate);

        const excelPath = await this.generateReport(extractedData, `Reporte_${params.cliente || 'General'}`, headerData);
        const pdfPath = await PdfReportService.generatePdfReport(extractedData, `Reporte_${params.cliente || 'General'}`, headerData);



        return [excelPath, pdfPath];
      }

    } catch (error) {
      logger.error('Error generando reporte desde DB', error);
      throw error;
    } finally {
      // No desconectamos la instancia global
    }
  }
}