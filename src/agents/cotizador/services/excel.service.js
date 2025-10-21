import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXCEL_DIR = path.join(__dirname, '../data/productos');

export class ExcelService {
  static leerTodosLosProductos() {
    // Lee TODOS los archivos Excel sin importar el nombre
    const archivos = fs.readdirSync(EXCEL_DIR).filter(f => 
      f.endsWith('.xlsx') || 
      f.endsWith('.xls') || 
      f.endsWith('.XLSX') || 
      f.endsWith('.XLS')
    );
    
    const productos = [];

    archivos.forEach(archivo => {
      try {
        const ruta = path.join(EXCEL_DIR, archivo);
        const workbook = XLSX.readFile(ruta);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet);

        data.forEach(item => {
          // Mapear las columnas específicas de Microsoft
          const producto = {
            // Identificación
            id: item.ProductId || item.SkuTitle || '',
            nombre: item.ProductTitle || item.SkuTitle || '',
            sku: item.SkuTitle || '',
            
            // Información del producto
            descripcion: item.SkuDescription || item.ProductTitle || '',
            fabricante: item.Publisher || '',
            
            // Detalles comerciales
            precio: parseFloat(item.UnitPrice) || 0,
            moneda: item.Currency || 'USD',
            mercado: item.Market || '',
            
            // Términos y billing
            duracionTermino: item.TermDuration || '',
            planFacturacion: item.BillingPlan || '',
            
            // Clasificación
            categoria: item.Tags || '',
            segmento: item.Segment || '',
            
            // Metadata
            archivo: archivo,
            
            // Guardar todos los datos originales por si se necesitan
            _raw: item
          };

          productos.push(producto);
        });

        console.log(`✅ Leídos ${data.length} productos del archivo: ${archivo}`);
      } catch (error) {
        console.error(`❌ Error al leer archivo ${archivo}:`, error.message);
      }
    });

    console.log(`📊 Total de productos cargados: ${productos.length}`);
    return productos;
  }

  static obtenerEstadisticas() {
    const productos = this.leerTodosLosProductos();
    
    return {
      total: productos.length,
      porFabricante: this.agruparPor(productos, 'fabricante'),
      porCategoria: this.agruparPor(productos, 'categoria'),
      porSegmento: this.agruparPor(productos, 'segmento'),
      porMoneda: this.agruparPor(productos, 'moneda'),
      rangoPrecios: {
        minimo: Math.min(...productos.map(p => p.precio)),
        maximo: Math.max(...productos.map(p => p.precio)),
        promedio: productos.reduce((sum, p) => sum + p.precio, 0) / productos.length
      }
    };
  }

  static agruparPor(productos, campo) {
    return productos.reduce((acc, producto) => {
      const valor = producto[campo] || 'Sin clasificar';
      acc[valor] = (acc[valor] || 0) + 1;
      return acc;
    }, {});
  }

  static buscarPorNombre(termino) {
    const productos = this.leerTodosLosProductos();
    const terminoLower = termino.toLowerCase();
    
    return productos.filter(p => 
      p.nombre.toLowerCase().includes(terminoLower) ||
      p.descripcion.toLowerCase().includes(terminoLower) ||
      p.sku.toLowerCase().includes(terminoLower)
    );
  }

  static buscarPorFabricante(fabricante) {
    const productos = this.leerTodosLosProductos();
    return productos.filter(p => 
      p.fabricante.toLowerCase().includes(fabricante.toLowerCase())
    );
  }

  static filtrarPorPrecio(min, max) {
    const productos = this.leerTodosLosProductos();
    return productos.filter(p => p.precio >= min && p.precio <= max);
  }
}