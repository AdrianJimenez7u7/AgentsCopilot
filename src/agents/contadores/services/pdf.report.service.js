import path from 'path';
import fs from 'fs';
import PdfPrinter from 'pdfmake';
import { ReportService } from './report.service.js';
import { logger } from '../../../shared/utils/logger.js';
import { PrismaClient } from '@prisma/client';

const fonts = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique'
  }
};

const printer = new PdfPrinter(fonts);

export class PdfReportService {
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
      const logoBuffer = await ReportService.fetchImage(logoUrl);
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

      // Función mejorada para construir tablas
      const buildTable = (title, data, isColorMode = false) => {
        const body = [];

        // Header
        body.push([
          { text: 'Modelo', style: 'tableHeader' },
          { text: 'Tipo impresión', style: 'tableHeader' },
          { text: 'IP', style: 'tableHeader' },
          { text: 'Número de Serie', style: 'tableHeader' },
          { text: 'Ubicación', style: 'tableHeader' },
          { text: isColorMode ? 'Inicio Color' : 'Inicio BN', style: 'tableHeader' },
          { text: isColorMode ? 'Fin Color' : 'Fin BN', style: 'tableHeader' },
          { text: isColorMode ? 'Impresiones Color' : 'Impresiones BN', style: 'tableHeader' }
        ]);

        data.forEach(item => {
          const inicio = isColorMode ? (item.InicioColor || 0) : (item.InicioBN || 0);
          const fin = isColorMode ? (item.FinColor || 0) : (item.FinBN || 0);
          const hojas = isColorMode ? (item.ImpresionesColor || 0) : (item.Impresiones || 0);

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
        const total = isColorMode 
          ? ReportService.sumField(data, 'ImpresionesColor') 
          : ReportService.sumField(data, 'Impresiones');
        
        body.push([
          { text: `TOTAL ${title}`, colSpan: 7, bold: true, style: 'tableCell', alignment: 'right' }, 
          {}, {}, {}, {}, {}, {},
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

      // Construir las tres tablas con el parámetro correcto
      docDefinition.content.push({ text: 'EQUIPO MONOCROMATICO IMPRESIONES BLANCO Y NEGRO', style: 'sectionHeader' });
      docDefinition.content.push(buildTable('MONO BN', monochromeBW, false));

      docDefinition.content.push({ text: 'EQUIPO COLOR IMPRESIONES BLANCO Y NEGRO', style: 'sectionHeader' });
      docDefinition.content.push(buildTable('COLOR BN', colorBW, false));

      docDefinition.content.push({ text: 'EQUIPO COLOR IMPRESIONES COLOR', style: 'sectionHeader' });
      docDefinition.content.push(buildTable('COLOR COLOR', colorColor, true));

      // Totales finales
      docDefinition.content.push({ text: 'Totales', style: 'sectionHeader', margin: [0, 20, 0, 5] });

      // Consultar precios del cliente
      const prisma = new PrismaClient({
        datasources: {
          db: {
            url: process.env.DATABASE_URL
          }
        }
      });
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
        await prisma.$disconnect();
      }

      const totals = [
        { concepto: 'Total de hojas Blanco y Negro equipo monocromatico', cantidad: ReportService.sumField(monochromeBW, 'Impresiones'), precio: precioBN },
        { concepto: 'Total de hojas Blanco y Negro equipo monocromatico (otro precio)', cantidad: ReportService.sumField(monochromeBW, 'Impresiones'), precio: precioBN },
        { concepto: 'Total de hojas impresas Blanco y Negro equipo color', cantidad: ReportService.sumField(colorBW, 'Impresiones'), precio: precioBN },
        { concepto: 'Total de hojas impresas Color equipo color', cantidad: ReportService.sumField(colorColor, 'ImpresionesColor'), precio: precioColor }
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

      let grandTotal = 0;
      const totalsBody = [
        [{ text: 'Concepto', style: 'tableHeader' }, { text: 'Cantidad', style: 'tableHeader' }, { text: 'Precio Unitario', style: 'tableHeader' }, { text: 'Total', style: 'tableHeader' }]
      ];

      totals.forEach(t => {
        const lineTotal = (Number(t.cantidad) || 0) * Number(t.precio);
        grandTotal += lineTotal;
        totalsBody.push([
          { text: t.concepto, style: 'tableCell' },
          { text: t.cantidad.toString(), style: 'tableCell' },
          { text: `$${t.precio.toFixed(2)}`, style: 'tableCell' },
          { text: `$${lineTotal.toFixed(2)}`, style: 'tableCell' }
        ]);
      });

      // Add blank row
      totalsBody.push([
        { text: '', style: 'tableCell' },
        { text: '', style: 'tableCell' },
        { text: '', style: 'tableCell' },
        { text: '', style: 'tableCell' }
      ]);

      // Add final total row
      totalsBody.push([
        { text: '', style: 'tableCell' },
        { text: '', style: 'tableCell' },
        { text: 'TOTAL', style: 'tableCell', bold: true },
        { text: `$${grandTotal.toFixed(2)}`, style: 'tableCell', bold: true }
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
}