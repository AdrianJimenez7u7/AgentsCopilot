import { fileURLToPath } from 'url';
import path from 'path';

// Ruta absoluta al servicio IA (ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const iaPath = path.join(__dirname, '..', 'src', 'agents', 'cotizador', 'services', 'ia.service.js');

(async () => {
  // Import dinámico
  const { IAService } = await import(iaPath);

  // Datos de prueba: 2 productos simples
  const todosProductos = [
    { nombre: '10-year audit log retention', sku: 'CFQ7TTC0HL8Z', precio: 19.8, archivo: 'LISTA DE PRECIOS NCE.xlsx', _raw: { UnitPrice: 19.8 }, descripcion: '10-year audit log retention' },
    { nombre: 'Microsoft 365 Copilot', sku: 'COPILOT-1', precio: 100, archivo: 'LISTA DE PRECIOS NCE.xlsx', _raw: { UnitPrice: 100 }, descripcion: 'Copilot for Microsoft 365' }
  ];

  const solicitud = 'Quiero 20 licencia de 10-Year Audit Log Retention Add On y otras 50 de copilot por un año';

  // Mock fetch para devolver una respuesta truncada (simula corte de la IA)
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: '[\n  {"index":0,"quantity":20},\n  {"index":1,"quantity":50},\n'
          }
        }
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
    })
  });

  try {
    const res = await IAService.buscarProductosRelevantes(solicitud, todosProductos);
    res.productos.forEach((p, i) => {
    });
  } catch (e) {
    console.error('Error en test:', e);
  }
})();
