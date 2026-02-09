import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { errorHandler } from './shared/middleware/error.middleware.js';
import { apiKeyAuth } from './shared/middleware/auth.middleware.js';

// Importar rutas de agentes
import cotizadorRoutes from './agents/cotizador/routes/cotizacion.routes.js';
import contadoresRoutes from './agents/contadores/routes/contadores.routes.js';
import PMsitoRoutes from './agents/PMsito/routes/reportes.routes.js';
import ariaRoutes from './agents/aria/routes/aria.routes.js';
import administracionRoutes from './agents/administracion/routes/administracion.routes.js';

const app = express();

// Mover trust proxy aquí (antes de middlewares que usan req.ip)
app.set('trust proxy', 1);

// Middlewares globales
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100 // límite de 100 peticiones por ventana
});
app.use(limiter);

// Rutas públicas (sin auth)
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'API de Agentes - Bienvenido',
    version: '1.0.0',
    agentes: [
      {
        nombre: 'Cotizador',
        descripcion: 'Genera cotizaciones desde archivos Excel',
        endpoints: [
          'POST /agente/cotizador/generar',
          'GET /agente/cotizador/productos'
        ]
      },
      {
        nombre: 'Contadores',
        descripcion: 'Analiza archivos de impresoras y divide PDFs por páginas',
        endpoints: [
          'POST /agente/contadores/split-pdf',
          'DELETE /agente/contadores/clean-output',
          'POST /agente/contadores/analyze-pdfs',
          'POST /agente/contadores/process-pdf'
        ]
      }
    ]
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Aplicar autenticación a todas las rutas de API (opcional)
// app.use('/agente', apiKeyAuth);
app.use('/agente/PMsito', PMsitoRoutes);
app.use('/agente/aria', ariaRoutes);

app.use(apiKeyAuth);
// Rutas de agentes
app.use('/agente/cotizador', cotizadorRoutes);
app.use('/agente/contadores', contadoresRoutes);
app.use('/agente/administracion', administracionRoutes);

// Middleware de manejo de errores (debe ir al final)
app.use(errorHandler);

// Ruta 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint no encontrado'
  });
});

export default app;