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
          // Normalizar claves: quitar espacios alrededor de los nombres de columna
          const normalized = {};
          Object.keys(item).forEach(k => {
            const key = (k || '').toString().trim();
            // si la clave ya existe, mantener el primero (evitar sobrescribir accidentalmente)
            if (!Object.prototype.hasOwnProperty.call(normalized, key)) {
              normalized[key] = item[k];
            }
          });
          const row = normalized;
          // Función para parsear precios desde UnitPrice
          const parsePrice = v => {
            const debug = process.env.DEBUG_EXCEL_PARSE === '1';
            if (v == null) {
              if (debug) console.log('parsePrice: valor es null/undefined');
              return 0;
            }

            // Si ya es un número, retornarlo directamente
            if (typeof v === 'number') {
              if (debug) console.log('parsePrice: valor ya es número:', v);
              return v;
            }

            // Convertir a string y limpiar
            const original = v.toString();
            if (debug) console.log('parsePrice: valor original:', original);

            // Eliminar símbolos de moneda y comas, mantener puntos decimales
            const cleaned = original.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
            if (debug) console.log('parsePrice: valor limpio:', cleaned);

            // Convertir a número
            const n = parseFloat(cleaned);
            if (debug) console.log('parsePrice: valor parseado:', n);

            if (isNaN(n)) {
              if (debug) console.log('parsePrice: no se pudo parsear a número');
              return 0;
            }

            return n;
          };

          // Debug: mostrar las claves detectadas en la fila (ej. para detectar ' UnitPrice' con espacio)
          if (Object.keys(row).length && process.env.DEBUG_EXCEL_KEYS === '1') {
            console.log('Debug - claves de la fila normalizada (primeras 10):', Object.keys(row).slice(0,10));
          }

          // Debug: mostrar el valor de UnitPrice antes del parseo (usa la fila normalizada)
          if (row.UnitPrice !== undefined && process.env.DEBUG_EXCEL_PARSE === '1') {
            console.log(`Debug - UnitPrice raw para ${row.SkuTitle || row.Sku || 'N/A'}:`, {
              value: row.UnitPrice,
              type: typeof row.UnitPrice
            });
          }

          const precio = parsePrice(row.UnitPrice);
          
          const producto = {
            // Identificación
            id: row.ProductId || row.SkuId || row.Sku || row.SkuTitle || '',
            nombre: row.ProductTitle || row.SkuTitle || row.Sku || '',
            sku: row.SkuTitle || row.Sku || '',
            
            // Información del producto
            descripcion: row.SkuDescription || row.ProductTitle || '',
            fabricante: row.Publisher || '',
            
            // Detalles comerciales
            precio: precio,
            precioOriginal: row.UnitPrice, // Guardamos el valor original para debug
            moneda: row.Currency || 'USD',
            mercado: row.Market || '',
            
            // Términos y billing
            duracionTermino: row.TermDuration || row.TermDurat || row.Term || '',
            planFacturacion: row.BillingPlan || row.Billing || '',
            
            // Clasificación
            categoria: row.Tags || '',
            segmento: row.Segment || '',
            
            // Metadata
            archivo: archivo,
            
            // Guardar todos los datos originales por si se necesitan
            _raw: row
          };

          productos.push(producto);
        });

        // Mostrar algunos ejemplos de parsing para depuración
        try {
          const ejemplo = data[0] || {};
          console.log(`✅ Leídos ${data.length} productos del archivo: ${archivo} (ejemplo UnitPrice raw: "${ejemplo.UnitPrice}")`);
        } catch (e) {
          console.log(`✅ Leídos ${data.length} productos del archivo: ${archivo}`);
        }
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