import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class DocumentService {
  static generarCotizacion(productos, clienteInfo) {
    const templatePath = path.join(__dirname, '../templates/cotizacion_template.docx');
    const content = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true
    });

    const total = productos.reduce((sum, p) => sum + (p.precio * (p.cantidad || 1)), 0);

    doc.render({
      fecha: new Date().toLocaleDateString('es-MX'),
      cliente: clienteInfo.nombre || 'Cliente',
      email: clienteInfo.email || '',
      productos: productos.map(p => ({
        nombre: p.nombre,
        descripcion: p.descripcion,
        cantidad: p.cantidad || 1,
        precio: p.precio.toFixed(2),
        subtotal: (p.precio * (p.cantidad || 1)).toFixed(2)
      })),
      total: total.toFixed(2)
    });

    const buf = doc.getZip().generate({ type: 'nodebuffer' });
    const outputPath = path.join(__dirname, `../output/cotizacion_${Date.now()}.docx`);
    fs.writeFileSync(outputPath, buf);

    return outputPath;
  }
}