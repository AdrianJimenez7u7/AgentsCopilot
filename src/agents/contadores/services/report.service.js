import path from 'path';
import fs from 'fs';
import ExcelJS from 'exceljs';
import { logger } from '../../../shared/utils/logger.js';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import PdfPrinter from 'pdfmake';

const fonts = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique'
  }
};

const printer = new PdfPrinter(fonts);

export class ReportService {
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
        { key: 'Inicio', width: 18 },
        { key: 'Fin', width: 18 },
        { key: 'Hojas', width: 16 }
      ];

      // Logo - Ocupa A1:B2
      const logoUrl = 'https://compucad.com.mx/wp-content/uploads/2024/05/compucad-logotipo-2024-copy.png';
      const logoBuffer = await this.fetchImage(logoUrl);
      if (logoBuffer) {
        const imageId = workbook.addImage({
          buffer: logoBuffer,
          extension: 'png',
        });
        ws.addImage(imageId, {
          tl: { col: 0, row: 0 },
          br: { col: 2, row: 2 }
        });
      }

      // Ajustar altura de las filas del header
      ws.getRow(1).height = 25;
      ws.getRow(2).height = 25;

      // Header personalizado - Fila 1
      ws.mergeCells('C1:D1');
      ws.getCell('C1').value = `Cliente: ${headerData.cliente || ''}`;
      ws.getCell('C1').font = { bold: true, size: 11, color: { argb: 'FF000000' } };
      ws.getCell('C1').alignment = { vertical: 'middle', horizontal: 'left' };
      ws.getCell('C1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };

      ws.mergeCells('E1:G1');
      ws.getCell('E1').value = `Periodo: ${headerData.inicio || ''} - ${headerData.fin || ''}`;
      ws.getCell('E1').font = { bold: true, size: 11, color: { argb: 'FF000000' } };
      ws.getCell('E1').alignment = { vertical: 'middle', horizontal: 'center' };
      ws.getCell('E1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };

      ws.mergeCells('H1:H1');
      ws.getCell('H1').value = `Mes: ${headerData.mes || ''}`;
      ws.getCell('H1').font = { bold: true, size: 11, color: { argb: 'FF000000' } };
      ws.getCell('H1').alignment = { vertical: 'middle', horizontal: 'center' };
      ws.getCell('H1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7E6E6' } };

      // Aplicar bordes
      const headerBorder = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } }
      };
      ws.getCell('C1').border = headerBorder;
      ws.getCell('E1').border = headerBorder;
      ws.getCell('H1').border = headerBorder;

      // Título principal
      let cursorRow = 3;
      ws.mergeCells(`A${cursorRow}:H${cursorRow}`);
      const titleCell = ws.getCell(`A${cursorRow}`);
      titleCell.value = 'REPORTE DE IMPRESIONES';
      titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
      titleCell.font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB15000' } };
      ws.getRow(cursorRow).height = 30;
      cursorRow++;

      const renderSection = (title, data = []) => {
        ws.mergeCells(`A${cursorRow}:H${cursorRow}`);
        const secCell = ws.getCell(`A${cursorRow}`);
        secCell.value = title;
        secCell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
        secCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB15000' } };
        secCell.alignment = { horizontal: 'left', vertical: 'middle' };
        cursorRow++;

        // Header row simple
        const headerRow = ws.getRow(cursorRow);

        // Determinar qué valores mostrar según la categoría
        const esBN = title.includes('BLANCO Y NEGRO');
        const esColor = title.includes('COLOR') && !title.includes('BLANCO');

        const headers = [
          'Modelo',
          'Tipo impresión',
          'IP',
          'Número de Serie',
          'Ubicación',
          esBN ? 'Inicio BN' : 'Inicio Color',
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

            if (esBN) {
              row.getCell(6).value = Number(item.InicioBN) || 0;
              row.getCell(7).value = Number(item.FinBN) || 0;
              row.getCell(8).value = Number(item.Impresiones) || 0;
            } else if (esColor) {
              row.getCell(6).value = Number(item.InicioColor) || 0;
              row.getCell(7).value = Number(item.FinColor) || 0;
              row.getCell(8).value = Number(item.ImpresionesColor) || 0;
            }

            cursorRow++;
          }
        }

        // Total row
        const totalRow = ws.getRow(cursorRow);
        ws.mergeCells(cursorRow, 1, cursorRow, 7);
        totalRow.getCell(1).value = `TOTAL DE IMPRESIONES ${title.toUpperCase()}`;
        totalRow.getCell(1).font = { bold: true };
        totalRow.getCell(1).alignment = { horizontal: 'right' };

        const total = esBN ? this.sumField(data || [], 'Impresiones') : this.sumField(data || [], 'ImpresionesColor');
        totalRow.getCell(8).value = total;
        totalRow.getCell(8).font = { bold: true };
        cursorRow += 2;
      };

      renderSection('EQUIPO MONOCROMATICO IMPRESIONES BLANCO Y NEGRO', monochromeBW);
      renderSection('EQUIPO COLOR IMPRESIONES BLANCO Y NEGRO', colorBW);
      renderSection('EQUIPO COLOR IMPRESIONES COLOR', colorColor);

      // Totales finales
      ws.mergeCells(`A${cursorRow}:C${cursorRow}`);
      ws.getCell(`A${cursorRow}`).value = 'Totales';
      ws.getCell(`A${cursorRow}`).font = { bold: true };
      cursorRow++;

      const totals = [
        { concepto: 'Total de hojas Blanco y Negro equipo monocromatico', cantidad: this.sumField(monochromeBW, 'Impresiones'), precio: 0.18 },
        { concepto: 'Total de hojas Blanco y Negro equipo monocromatico (otro precio)', cantidad: this.sumField(monochromeBW, 'Impresiones'), precio: 0.28 },
        { concepto: 'Total de hojas impresas Blanco y Negro equipo color', cantidad: this.sumField(colorBW, 'Impresiones'), precio: 0.23 },
        { concepto: 'Total de hojas impresas Color equipo color', cantidad: this.sumField(colorColor, 'ImpresionesColor'), precio: 0.95 },
        { concepto: 'MONTO FIJO RENTA DE EQUIPO', cantidad: 1, precio: 14375 }
      ];

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
        if (r > 3) {
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

  static async generatePdfReport(extractedData, originalFileName, headerData = {}) {
    try {
      const monochromePrinters = [];
      const colorPrinters = [];

      for (const item of extractedData) {
        if (item.datos && !item.datos.mensaje) {
          const data = item.datos;
          const tipo = (data.TipoImpresora || '').toLowerCase();
          const isColor = tipo.includes('color');
          if (isColor) colorPrinters.push(data);
          else monochromePrinters.push(data);
        }
      }

      const monochromeBW = monochromePrinters.map(d => ({ ...d, ImpresionesColor: 0 }));
      const colorBW = colorPrinters.map(d => ({ ...d, ImpresionesColor: 0 }));
      const colorColor = colorPrinters.map(d => ({ ...d, Impresiones: 0 }));

      const logoUrl = 'https://compucad.com.mx/wp-content/uploads/2024/05/compucad-logotipo-2024-copy.png';
      const logoBuffer = await this.fetchImage(logoUrl);
      const logoBase64 = logoBuffer ? `data:image/png;base64,${logoBuffer.toString('base64')}` : null;

      const docDefinition = {
        content: [
          {
            columns: [
              logoBase64 ? { image: logoBase64, width: 100 } : { text: 'COMPUCAD', bold: true },
              {
                stack: [
                  { text: `Cliente: ${headerData.cliente || ''}`, bold: true },
                  { text: `Periodo: ${headerData.inicio || ''} - ${headerData.fin || ''}`, bold: true },
                  { text: `Mes: ${headerData.mes || ''}`, bold: true }
                ],
                alignment: 'right'
              }
            ]
          },
          { text: 'REPORTE DE IMPRESIONES', style: 'header', margin: [0, 10, 0, 10] },
        ],
        styles: {
          header: { fontSize: 14, bold: true, alignment: 'center', color: 'white', fillColor: '#B15000' },
          sectionHeader: { fontSize: 12, bold: true, color: 'white', fillColor: '#B15000', margin: [0, 5, 0, 5] },
          tableHeader: { bold: true, fontSize: 10, color: 'white', fillColor: '#8C3300', alignment: 'center' },
          tableCell: { fontSize: 9 }
        },
        defaultStyle: { font: 'Helvetica' }
      };

      const buildTable = (title, data) => {
        const esBN = title.includes('BLANCO Y NEGRO');
        const body = [];

        // Header
        body.push([
          { text: 'Modelo', style: 'tableHeader' },
          { text: 'Tipo', style: 'tableHeader' },
          { text: 'IP', style: 'tableHeader' },
          { text: 'Serie', style: 'tableHeader' },
          { text: 'Ubicación', style: 'tableHeader' },
          { text: esBN ? 'Inicio BN' : 'Inicio Color', style: 'tableHeader' },
          { text: esBN ? 'Fin BN' : 'Fin Color', style: 'tableHeader' },
          { text: esBN ? 'Impresiones BN' : 'Impresiones Color', style: 'tableHeader' }
        ]);

        data.forEach(item => {
          const inicio = esBN ? (item.InicioBN || 0) : (item.InicioColor || 0);
          const fin = esBN ? (item.FinBN || 0) : (item.FinColor || 0);
          const hojas = esBN ? (item.Impresiones || 0) : (item.ImpresionesColor || 0);

          body.push([
            { text: item.Modelo || '', style: 'tableCell' },
            { text: item.TipoImpresion || '', style: 'tableCell' },
            { text: item.ip || item.Ip || '', style: 'tableCell' },
            { text: item.Serie || '', style: 'tableCell' },
            { text: item.Ubicacion || '', style: 'tableCell' },
            { text: inicio.toString(), style: 'tableCell' },
            { text: fin.toString(), style: 'tableCell' },
            { text: hojas.toString(), style: 'tableCell' }
          ]);
        });

        // Total
        const total = esBN ? this.sumField(data, 'Impresiones') : this.sumField(data, 'ImpresionesColor');
        body.push([
          { text: `TOTAL ${title}`, colSpan: 7, bold: true, style: 'tableCell', alignment: 'right' }, {}, {}, {}, {}, {}, {},
          { text: total.toString(), bold: true, style: 'tableCell' }
        ]);

        return {
          table: {
            headerRows: 1,
            widths: ['auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
            body: body
          },
          layout: 'lightHorizontalLines'
        };
      };

      docDefinition.content.push({ text: 'EQUIPO MONOCROMATICO IMPRESIONES BLANCO Y NEGRO', style: 'sectionHeader' });
      docDefinition.content.push(buildTable('MONO BN', monochromeBW));

      docDefinition.content.push({ text: 'EQUIPO COLOR IMPRESIONES BLANCO Y NEGRO', style: 'sectionHeader' });
      docDefinition.content.push(buildTable('COLOR BN', colorBW));

      docDefinition.content.push({ text: 'EQUIPO COLOR IMPRESIONES COLOR', style: 'sectionHeader' });
      docDefinition.content.push(buildTable('COLOR COLOR', colorColor));

      // Totales finales
      docDefinition.content.push({ text: 'TOTALES', style: 'sectionHeader', margin: [0, 20, 0, 5] });

      const totals = [
        { c: 'Total Hojas BN Mono', q: this.sumField(monochromeBW, 'Impresiones'), p: 0.18 },
        { c: 'Total Hojas BN Mono (otro)', q: this.sumField(monochromeBW, 'Impresiones'), p: 0.28 },
        { c: 'Total Hojas BN Color', q: this.sumField(colorBW, 'Impresiones'), p: 0.23 },
        { c: 'Total Hojas Color', q: this.sumField(colorColor, 'ImpresionesColor'), p: 0.95 },
        { c: 'Renta Equipo', q: 1, p: 14375 }
      ];

      let grandTotal = 0;
      const totalsBody = [
        [{ text: 'Concepto', style: 'tableHeader' }, { text: 'Cantidad', style: 'tableHeader' }, { text: 'Precio', style: 'tableHeader' }, { text: 'Total', style: 'tableHeader' }]
      ];

      totals.forEach(t => {
        const total = (Number(t.q) || 0) * t.p;
        grandTotal += total;
        totalsBody.push([
          { text: t.c, style: 'tableCell' },
          { text: t.q.toString(), style: 'tableCell' },
          { text: `$${t.p.toFixed(2)}`, style: 'tableCell' },
          { text: `$${total.toFixed(2)}`, style: 'tableCell' }
        ]);
      });

      totalsBody.push([
        { text: 'GRAN TOTAL', colSpan: 3, bold: true, style: 'tableCell' }, {}, {},
        { text: `$${grandTotal.toFixed(2)}`, bold: true, style: 'tableCell' }
      ]);

      docDefinition.content.push({
        table: {
          headerRows: 1,
          widths: ['*', 'auto', 'auto', 'auto'],
          body: totalsBody
        }
      });

      const reportsDir = path.join('src', 'agents', 'contadores', 'Reports');
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }
      const baseName = path.parse(originalFileName).name;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `${baseName}_reporte_${timestamp}.pdf`;
      const filePath = path.join(reportsDir, fileName);

      const pdfDoc = printer.createPdfKitDocument(docDefinition);
      const writeStream = fs.createWriteStream(filePath);
      pdfDoc.pipe(writeStream);
      pdfDoc.end();

      return new Promise((resolve, reject) => {
        writeStream.on('finish', () => {
          logger.info('Reporte PDF generado', { filePath });
          resolve(filePath);
        });
        writeStream.on('error', reject);
      });

    } catch (error) {
      logger.error('Error generando reporte PDF', error);
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
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL
        }
      }
    });
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

        const reports = [];
        for (const c of clientes) {
          const registros = await prisma.contadores.findMany({
            where: {
              Cliente: c.Cliente,
              Estatus: null
            }
          });

          if (registros.length > 0) {
            const extractedData = await Promise.all(registros.map(async (r) => {
              // Estrategia de búsqueda robusta:
              // 1. Intentar coincidencia exacta: Cliente + Serie + Modelo
              let registroAnterior = null;

              if (r.Modelo) {
                registroAnterior = await prisma.contadoresInfoClientes.findFirst({
                  where: {
                    Cliente: c.Cliente,
                    Serie: r.Serie,
                    Modelo: r.Modelo
                  },
                  orderBy: { id: 'desc' }
                });
              }

              // 2. Si no se encuentra, intentar coincidencia por Cliente + Serie (tomando el último)
              if (!registroAnterior) {
                registroAnterior = await prisma.contadoresInfoClientes.findFirst({
                  where: {
                    Cliente: c.Cliente,
                    Serie: r.Serie
                  },
                  orderBy: { id: 'desc' }
                });
              }

              const bnActual = r.ImpresionesBN || 0;
              const colorActual = r.ImpresionesColor || 0;
              const bnAnterior = registroAnterior?.BN || 0;
              const colorAnterior = registroAnterior?.Color || 0;

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
                  TipoImpresora: r.TipoImpresora
                }
              };
            }));

            const firstDate = registros[0].FechaCaptura ? new Date(registros[0].FechaCaptura).toISOString().slice(0, 7) : params.mes;
            const headerData = getHeaderData(c.Cliente, firstDate);

            const excelPath = await this.generateReport(extractedData, `Reporte_${c.Cliente}`, headerData);
            const pdfPath = await this.generatePdfReport(extractedData, `Reporte_${c.Cliente}`, headerData);

            reports.push({
              cliente: c.Cliente,
              reporte: [excelPath, pdfPath]
            });

            if (!params.dryRun) {
              for (const r of registros) {
                const existente = await prisma.contadoresInfoClientes.findFirst({
                  where: {
                    Cliente: c.Cliente,
                    Serie: r.Serie
                  }
                });

                if (existente) {
                  await prisma.contadoresInfoClientes.update({
                    where: { id: existente.id },
                    data: {
                      Modelo: r.Modelo,
                      IP: r.Ip,
                      ImpresionesActuales: r.TotalImpresiones,
                      BN: r.ImpresionesBN,
                      Color: r.ImpresionesColor,
                      FechaLimiteReporte: new Date()
                    }
                  });
                } else {
                  await prisma.contadoresInfoClientes.create({
                    data: {
                      Cliente: c.Cliente,
                      Modelo: r.Modelo,
                      Serie: r.Serie,
                      IP: r.Ip,
                      ImpresionesActuales: r.TotalImpresiones,
                      BN: r.ImpresionesBN,
                      Color: r.ImpresionesColor,
                      FechaLimiteReporte: new Date()
                    }
                  });
                }
              }

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
        return reports;
      } else {
        const where = {};
        if (params.cliente) where.Cliente = params.cliente;

        const registros = await prisma.contadores.findMany({ where });

        const extractedData = await Promise.all(registros.map(async (r) => {
          // Estrategia de búsqueda robusta:
          // 1. Intentar coincidencia exacta: Cliente + Serie + Modelo
          let registroAnterior = null;

          if (r.Modelo) {
            registroAnterior = await prisma.contadoresInfoClientes.findFirst({
              where: {
                Cliente: r.Cliente,
                Serie: r.Serie,
                Modelo: r.Modelo
              },
              orderBy: { id: 'desc' }
            });
          }

          // 2. Si no se encuentra, intentar coincidencia por Cliente + Serie (tomando el último)
          if (!registroAnterior) {
            registroAnterior = await prisma.contadoresInfoClientes.findFirst({
              where: {
                Cliente: r.Cliente,
                Serie: r.Serie
              },
              orderBy: { id: 'desc' }
            });
          }

          const bnActual = r.ImpresionesBN || 0;
          const colorActual = r.ImpresionesColor || 0;
          const bnAnterior = registroAnterior?.BN || 0;
          const colorAnterior = registroAnterior?.Color || 0;

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
              TipoImpresora: r.TipoImpresora
            }
          };
        }));

        const firstDate = registros.length > 0 && registros[0].FechaCaptura ? new Date(registros[0].FechaCaptura).toISOString().slice(0, 7) : params.mes;
        const headerData = getHeaderData(params.cliente || 'General', firstDate);

        const excelPath = await this.generateReport(extractedData, `Reporte_${params.cliente || 'General'}`, headerData);
        const pdfPath = await this.generatePdfReport(extractedData, `Reporte_${params.cliente || 'General'}`, headerData);

        if (!params.dryRun) {
          for (const r of registros) {
            const existente = await prisma.contadoresInfoClientes.findFirst({
              where: {
                Cliente: r.Cliente,
                Serie: r.Serie
              }
            });

            if (existente) {
              await prisma.contadoresInfoClientes.update({
                where: { id: existente.id },
                data: {
                  Modelo: r.Modelo,
                  IP: r.Ip,
                  ImpresionesActuales: r.TotalImpresiones,
                  BN: r.ImpresionesBN,
                  Color: r.ImpresionesColor,
                  FechaLimiteReporte: new Date()
                }
              });
            } else {
              await prisma.contadoresInfoClientes.create({
                data: {
                  Cliente: r.Cliente,
                  Modelo: r.Modelo,
                  Serie: r.Serie,
                  IP: r.Ip,
                  ImpresionesActuales: r.TotalImpresiones,
                  BN: r.ImpresionesBN,
                  Color: r.ImpresionesColor,
                  FechaLimiteReporte: new Date()
                }
              });
            }
          }
        }

        return [excelPath, pdfPath];
      }

    } catch (error) {
      logger.error('Error generando reporte desde DB', error);
      throw error;
    } finally {
      await prisma.$disconnect();
    }
  }
}