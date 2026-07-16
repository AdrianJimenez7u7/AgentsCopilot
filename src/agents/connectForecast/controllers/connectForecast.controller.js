import { ConnectForecastAgentService } from '../services/connectForecast.agent.service.js';

function getErrorStatusCode(error) {
  return error.message?.includes('Areas no permitidas')
    || error.message?.includes('No se encontraron areas validas')
    || error.message?.includes('Falta question')
    || error.message?.includes('filtro')
    || error.message?.includes('estatus')
    || error.message?.includes('ejecutivo')
    ? 400
    : 500;
}

function logControllerError(message, error) {
  if (getErrorStatusCode(error) === 400) {
    console.warn(message, error.message);
    return;
  }

  console.error(message, error);
}

export class ConnectForecastController {
  static async query(req, res) {
    try {
      const agentService = new ConnectForecastAgentService();
      const result = await agentService.ask(req.body || {});

      return res.status(200).json(result);
    } catch (error) {
      logControllerError('Error en consulta conversacional Connect Forecast:', error);
      const statusCode = getErrorStatusCode(error);
      return res.status(statusCode).json({ error: error.message });
    }
  }
}
