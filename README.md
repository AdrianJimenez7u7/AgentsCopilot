# AgentsCopilot (api-agentes)

API modular en Node.js/Express que expone múltiples **agentes de IA** como servicios HTTP independientes, todos montados sobre un mismo servidor. Cada agente vive en su propia carpeta bajo `src/agents/` con sus propios controllers, routes y services.

## Stack técnico

- **Runtime**: Node.js (ESM), Express 4
- **Base de datos**: Prisma ORM (`prisma/schema.prisma`)
- **IA**: Azure OpenAI / OpenAI SDK, Azure AI Document Intelligence, Tavily
- **Documentos**: docxtemplater, pdf-lib, pdfmake, exceljs
- **Automatización**: Playwright (agente de computer use), node-cron (jobs programados)
- **Seguridad**: helmet, express-rate-limit, JWT (Azure AD / Entra ID) para rutas que lo requieren

## Puesta en marcha

```bash
npm install
npm run dev     # con nodemon
npm start       # producción
```


## Autenticación

La mayoría de los endpoints van protegidos con `apiKeyAuth` (header `x-api-key`). Algunas rutas usan mecanismos propios:

| Agente / ruta | Mecanismo |
|---|---|
| `/agente/copilot` | JWT de Azure AD (Entra ID) |
| `/agente/pruebas-hudspot` | Token propio vía header (`x-hudspot-token`, `Authorization: Bearer`, etc.) |
| `/csf` | Token propio en el body de la petición |
| `/agente/aria` | Sin autenticación |
| `/lab` | Sin autenticación (uso educativo interno) |
| `GET /agente/computer-use/bridge/status` | Pública (keepalive) |

## Agentes disponibles

### Cotizador — `/agente/cotizador`
Genera cotizaciones de licenciamiento de software a partir de un catálogo (Excel), usando IA para desambiguar productos cuando hay varias coincidencias, y produce un documento Word con opción de envío por correo.

- `POST /generar` — genera la cotización directa, o devuelve `candidates` si hay múltiples coincidencias.
- `POST /generar/candidates` — devuelve los candidatos y una tarjeta resumen con `sessionId`.
- `POST /generar/seleccionar` — recibe la selección (lenguaje natural) y genera la cotización final.
- `GET /productos` — lista el catálogo cargado.

Flujo de desambiguación:

```json
{
  "solicitud": "Dame 5 licencias Dynamics 365 Commerce",
  "cliente": { "nombre": "Juan", "email": "juan@example.com" },
  "selection": [{ "index": 2, "quantity": 5 }]
}
```

### Contadores — `/agente/contadores`
Gestión de contratos de renta de impresoras/copiadoras: análisis de reportes PDF de conteo de páginas (Azure AI Document Intelligence), administración de clientes/técnicos, cierres de facturación, alertas de reportes/escaneos faltantes y consultas a SAP.

Incluye CRUD de clientes, técnicos, cierres y cierres de facturación, endpoints de análisis/procesamiento de PDF, generación de reportes, alertas de faltantes y un chat con agente IA.

### PMsito — `/agente/PMsito`
Reportes de project management a partir de Planner, cruzados con casos de CRM (Dynamics/Dataverse): tareas, comentarios, extracciones y oportunidades asociadas a cada caso.

### Aria — `/agente/aria`
Agente conversacional con LLM, con dashboard de estadísticas, historial de chats y manejo de archivos adjuntos.

### Operaciones — `/agente/operaciones`
Agente amplio para el área de operaciones: búsqueda y validación de productos, cotización y seguimiento de envíos vía paquetería, un agente conversacional propio, gestión de permisos/tickets y un job de reporte diario.

### Copilot Studio — `/agente/copilot`
Puente hacia Microsoft Copilot Studio para enviar mensajes/actividades a un agente configurado, soportando selección dinámica de agente por nombre en la ruta.

### Computer Use — `/agente/computer-use`
Agente de automatización de escritorio/navegador (Playwright) con streaming de progreso (SSE) y un bridge por WebSocket para conectar un cliente remoto que ejecuta las acciones.

### Catálogo — `/agente/catalogo`
CRUD del catálogo interno de aplicaciones: configuraciones, aplicaciones, métricas y costos asociados.

### Evaluaciones — `/agente/evaluaciones`
Sistema de exámenes/evaluaciones de colaboradores: preguntas, respuestas, rankings, resultados, analítica por área/posición, calificación asistida por IA e importación masiva vía CSV.

### Connect Forecast — `/agente/connect-forecast`
Agente conversacional de forecast de ventas sobre Dataverse (Dynamics CRM). Interpreta la pregunta del usuario con un modelo de razonamiento y construye la consulta correspondiente contra las oportunidades del CRM.

- `POST /query` — único endpoint. Body principal: `{ question: string, report?: boolean, ...filtros opcionales }`.
  - **Modo informe** (`report: true` o pregunta tipo "dame el forecast"): devuelve un reporte de los próximos meses con resumen, nuevo negocio, renovaciones, top vendedores, próximos cierres y fechas vencidas.
  - **Modo consulta**: devuelve una agregación/ranking según la métrica solicitada.
  - Respuesta incluye siempre `answer` (texto), el resultado estructurado, las áreas consideradas y el consumo de tokens.

### Pruebas Hudspot — `/agente/pruebas-hudspot`
Endpoint de demo para captar intención de compra comercial y disparar una propuesta comercial generada por IA, enviada por correo a un destinatario configurado.

- `POST /interes` — Body: `{ interes: string, nombreCliente: string }`.
- Detecta si el interés apunta a Microsoft Copilot, Adobe Firefly o Autodesk, genera la propuesta con IA (con plantilla de respaldo si la IA no responde) y devuelve contexto útil para un agente conversacional: marca detectada, preguntas de discovery, siguientes acciones y resumen de la propuesta.

Requiere el header con el token propio (ver variable `TokenHudspot` en tu `.env`):

```json
{
  "interes": "Necesito una licencia de Copilot para 20 usuarios",
  "nombreCliente": "Cliente Demo"
}
```

### CSF — `/csf`
Extracción de datos de una Constancia de Situación Fiscal (México) enviada en base64, vía Azure Document Intelligence.

- `POST /extraer` — Body: `{ base64_code: string, TokenPowerPlatform: string }`.

### Lab Seguridad — `/lab`
Laboratorio interno de ciberseguridad de uso educativo: expone un tracking pixel para demostrar que las Adaptive Cards no validan URLs de imagen, y permite consultar las capturas registradas.

### Predicciones — `/api/predicciones`
Plataforma de gestión de modelos predictivos/ML: inferencias, resultados, archivos de datos, y una integración con Azure Machine Learning (endpoints batch/online, jobs, modelos).

### Extractor Contadores (planeado)
Carpeta reservada (`src/agents/extractorContadores`) aún sin implementación ni ruta registrada.

## Notas conocidas

- El endpoint raíz `GET /` lista un subconjunto de agentes; para el listado completo consulta esta tabla.
- El `.rest` de pruebas de Hudspot referencia un endpoint `atencion-cliente` que todavía no está implementado en el router.
