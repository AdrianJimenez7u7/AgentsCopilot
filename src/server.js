import 'dotenv/config';
import http from 'http';
import app from './app.js';
import { logger } from './shared/utils/logger.js';
import { attachBridgeWS } from './agents/computerUse/routes/computerUse.routes.js';
import { iniciarReporteDiario } from './shared/jobs/reporteDiario.job.js';

const PORT = process.env.PORT || 3000;

// Create HTTP server so we can attach the WebSocket bridge
const server = http.createServer(app);

// Attach WebSocket bridge endpoint (/agente/computer-use/bridge)
attachBridgeWS(server);

server.listen(PORT, () => {
  logger.info(`🚀 Servidor corriendo en puerto ${PORT}`);
  logger.info(`📝 Entorno: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`🔗 URL: http://localhost:${PORT}`);
  logger.info(`🌉 Bridge WS: ws://localhost:${PORT}/agente/computer-use/bridge`);

  iniciarReporteDiario();
});