# Modulo Contadores

## 1. Resumen ejecutivo
El modulo de Contadores administra el ciclo completo de lectura de impresoras cliente: recepcion de documentos, extraccion de datos con IA, actualizacion de base de datos, reporteo y alertamiento operativo.

Estado al cierre del proyecto:
- Volumen operativo aproximado: 600 impresoras en catalogo.
- Uso productivo dentro de la Plataforma de Innovacion.

## 2. Referencias oficiales del proyecto
- Repositorio: https://dev.azure.com/TransformacionDigitalCCAD/_git/AgentsCopilot
- Backend (base URL): https://innobackend-crgjb3gja3gfdsgs.southcentralus-01.azurewebsites.net/
- Frontend (dashboard Contadores): https://innofront-b4htgzhdb2gxe0ga.southcentralus-01.azurewebsites.net/contadores/dashboard/

## 3. Alcance funcional
El modulo cubre:
- Procesamiento de PDF de lecturas de impresoras.
- Extraccion estructurada de campos con Azure Document Intelligence.
- Validacion de relacion impresora cliente por serie.
- Persistencia de historico y estado actual de contadores.
- Alertas de reportes faltantes y escaneos faltantes.
- Operaciones CRUD del catalogo de impresoras cliente.

## 4. Integracion con Plataforma de Innovacion
La Plataforma de Innovacion consume los endpoints del backend para habilitar la operacion diaria en UI.

Flujo de integracion:
1. El usuario opera desde el dashboard de Contadores.
2. El frontend envía solicitudes REST al backend en /agente/contadores.
3. El backend ejecuta reglas operativas y actualizaciones en base de datos.
4. El frontend renderiza resultados, alertas y estado de cumplimiento.

Capacidades expuestas a la plataforma:
- Alta, edicion, eliminacion y carga masiva de impresoras cliente.
- Consulta de historico de contadores.
- Proceso de analisis documental (PDF).
- Consulta de faltantes y alertas operativas.

## 5. Integracion con Agente de IA
El modulo integra un agente de IA documental mediante Azure Document Intelligence.

Servicio implementado:
- AzureService: src/agents/contadores/services/azure.service.js

Modos de analisis:
- Model: usa modelo entrenado para campos estructurados.
- OCR: usa layout para lineas, palabras y tablas.

Variables de entorno obligatorias:
- AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
- AZURE_DOCUMENT_INTELLIGENCE_KEY
- AZURE_DOCUMENT_INTELLIGENCE_MODEL_ID

## 6. Arquitectura operativa
1. Recepcion de archivo PDF.
2. Separacion por paginas.
3. Analisis de cada pagina con IA.
4. Normalizacion de serie y busqueda en catalogo maestro.
5. Registro de lectura en historico.
6. Actualizacion de acumulados y fecha limite.
7. Generacion de reportes/alertas.

## 7. Modelo de datos

### 7.1 Tabla Contadores
Mapeo Prisma: model Contadores -> @@map("Contadores")

| Campo | Tipo | Nulo | Descripcion |
|---|---|---|---|
| id | Int (PK, autoincrement) | No | Identificador del registro historico |
| Modelo | String | Si | Modelo de impresora |
| TipoImpresion | String | Si | Tipo de impresion |
| Ip | String | Si | IP del equipo |
| Serie | String | Si | Serie de impresora |
| ImpresionesBN | Int | Si | Contador blanco y negro |
| ImpresionesColor | Int | Si | Contador color |
| TotalImpresiones | Int | Si | Total acumulado |
| Cliente | String | Si | Cliente asociado |
| FechaCaptura | DateTime | Si | Fecha/hora de captura |
| CostoTotal | Decimal(18,4) | Si | Costo asociado (si aplica) |
| Responsable | String | Si | Responsable del registro |
| Estatus | String | Si | Estado operativo |
| TipoImpresora | String | Si | Clasificacion de impresora |
| Adicional2..Adicional10 | String | Si | Campos complementarios |

Uso principal:
- Historico de lecturas por impresora.
- Base para analitica y seguimiento de cumplimiento.

### 7.2 Tabla ContadoresInfoClientes
Mapeo Prisma: model ContadoresInfoClientes -> @@map("ContadoresInfoClientes")

| Campo | Tipo | Nulo | Descripcion |
|---|---|---|---|
| id | Int (PK, autoincrement) | No | Identificador del catalogo |
| Cliente | String | Si | Nombre del cliente |
| Modelo | String | Si | Modelo del equipo |
| Serie | String | Si | Serie de impresora |
| IP | String | Si | IP registrada |
| ImpresionesActuales | Int | Si | Contador total actual |
| BN | Int | Si | Contador BN actual |
| Color | Int | Si | Contador color actual |
| Tecnico | String | Si | Tecnico responsable |
| FechaLimiteReporte | DateTime | Si | Fecha limite para proximo reporte |
| PrecioBN | Decimal(10,2) | Si | Precio por impresion BN |
| PrecioColor | Decimal(10,2) | Si | Precio por impresion color |
| RentaFija | Decimal(10,2) | Si | Renta fija |
| CostoExtra | Decimal(10,2) | Si | Costo extra |
| Ubicacion | String(50) | Si | Ubicacion del equipo |

Uso principal:
- Catalogo maestro de impresoras cliente.
- Estado operativo vigente por impresora.
- Fuente para faltantes y alertas.

## 8. Endpoints del modulo
Base path: /agente/contadores

### 8.1 Documentos y analisis IA
- POST /split-pdf
- DELETE /clean-output
- POST /analyze-pdfs
- POST /process-pdf

### 8.2 Reporteria
- GET /generate-report
- POST /generate-report
- GET /reportes-faltantes
- GET /alerta-reportes

### 8.3 Catalogo de clientes/impresoras
- GET /clientes
- GET /contadores
- POST /clientes
- PUT /clientes/:id
- DELETE /clientes/:id
- POST /clientes/bulk
- GET /tecnicos

### 8.4 Escaneos y cumplimiento
- GET /escaneos-faltantes
- POST /escaneos/importar
- GET /alerta-escaneos
- GET /alerta-escaneos-tecnico/:tecnico
- GET /validate-all-exist-reports-state-null
- POST /contadores/fecha

Nota de mantenimiento:
- El endpoint POST /clientes/bulk aparece duplicado en el archivo de rutas; funcionalmente representa la misma operacion.

## 9. Funciones implementadas

### 9.1 ContadoresController
Archivo: src/agents/contadores/controllers/contadores.controller.js

Funciones HTTP:
- splitPdf
- cleanOutput
- analyzePdfs
- processPdf
- generateReport
- getClientes
- getContadores
- createImpresoraCliente
- updateImpresoraCliente
- obtenerReportesFaltantes
- alertarReportesFaltantes
- alertarEscaneosFaltantes
- alertarEscaneosFaltantesPorTecnico
- escaneosFaltantes
- deleteCliente
- reportesTotalPorMes
- validateAllExistReportsStateNull
- obtenerContadoresPorFecha
- bulkClientesByCSV
- getTecnicos
- importarEscaneosExcel

Soporte/middleware:
- uploadPdf
- uploadCsv
- cleanOutputInternal

### 9.2 AzureService
Archivo: src/agents/contadores/services/azure.service.js

Funciones:
- constructor
- analyzeDocument
- analyzeAllPdfsInOutput

### 9.3 ClientesService
Archivo: src/agents/contadores/services/db/clientes.service.js

Funciones:
- obtenerClientes
- obtenerContadores
- crearImpresoraCliente
- actualizarImpresoraCliente
- obtenerEscaneosFaltantes
- deleteCliente
- bulkClientesByCSV
- getTecnicos

### 9.4 ContadoresService
Archivo: src/agents/contadores/services/db/contadores.service.js

Funciones:
- obtenerReportesFaltantes
- obtenerEscaneosFaltantes
- alertarReportesFaltantes
- alertarEscaneosFaltantes
- validateAllExistReportsStateNull
- obtenerContadoresPorFecha
- alertarEscaneosFaltantesPorTecnico

## 10. Reglas de negocio
- Relacion impresora-escaneo por serie, con tolerancia de variaciones 0/O.
- Se evita degradar acumulados si llega una lectura menor al total actual.
- En importacion masiva se evita duplicidad por mismo dia y mismo total.
- FechaLimiteReporte se desplaza al siguiente ciclo cuando aplica, ajustando dia valido de mes.

## 11. Riesgos y consideraciones
- La precision depende de la calidad del PDF y del entrenamiento del modelo IA.
- Series inconsistentes o mal capturadas pueden generar no-match.
- reportesTotalPorMes requiere revision funcional antes de publicacion formal.

## 12. Validacion recomendada
1. Confirmar variables AZURE_DOCUMENT_INTELLIGENCE_* por ambiente.
2. Ejecutar caso completo split-pdf -> process-pdf con documento real.
3. Verificar insercion en Contadores y actualizacion en ContadoresInfoClientes.
4. Validar faltantes y alertas por tecnico.
5. Validar flujo extremo a extremo desde frontend hasta backend.
