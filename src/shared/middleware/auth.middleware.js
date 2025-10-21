export const apiKeyAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  // Si no hay API_KEY configurada, permite todas las peticiones
  if (!process.env.API_KEY) {
    return next();
  }

  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({
      success: false,
      message: 'API Key inválida o no proporcionada'
    });
  }

  next();
};