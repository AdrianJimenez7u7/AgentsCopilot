# Modulo Operaciones (Azure Wiki)

## Objetivo
El modulo de Operaciones centraliza consulta y validacion de productos (SKU), clasificacion fiscal/comercial asistida por IA, y utilidades de permisos e integraciones empresariales.

## Flujo funcional principal
1. Usuario envia SKU o archivo de SKUs.
2. Se consulta contexto tecnico con Tavily Search.
3. Se clasifica el producto con Azure OpenAI (respuesta JSON estructurada).
4. Se guarda resultado pendiente para validacion humana.
5. Usuario valida en tarjeta adaptativa y se actualiza el estado.
6. Opcionalmente se sincroniza con sistemas corporativos.

## Integraciones
- Azure OpenAI (clasificacion de producto).
- Tavily Search API (contexto web tecnico para SKU).
- SAP Service Layer (consulta por orden/usuario).
- Microsoft Entra ID OAuth2 + Dataverse (Power Apps data plane).
- Microsoft Graph (SharePoint list/file operations).

## Variables de entorno usadas
IA y busqueda:
- AZURE_API_KEY
- AZURE_OPENAI_API_VERSION
- AZURE_OPENAI_MODEL
- AZURE_OPENAI_5_MINI_API_KEY
- AZURE_OPENAI_5_MINI_API_VERSION
- AZURE_OPENAI_5_MINI_ENDPOINT
- AZURE_OPENAI_5_MINI_MODEL
- TAVILY_API_KEY

SAP:
- SAP_BASE_URL
- SAP_USERNAME
- SAP_PASSWORD
- SAP_COMPANYDB

Power Apps / Graph:
- DYNAMIC_SECRET

## Endpoints principales
Base: /agente/operaciones

- POST /search
- POST /search/file
- GET /search/pending-validations
- PUT /search/validate/:id
- DELETE /search/pending/:id
- GET /search/all-products
- POST /search/validate-card
- POST /search-card
- POST /permissions
- POST /permissions/search
- POST /permissions/ticket
- POST /clasificar-test
- POST /my-data
- GET /products-from-sharepoint-list
- POST /user-by-purchase-order

## Entidad de base de datos
Tabla principal:
- ProductoPendienteValidation

Campos clave:
- sku
- descripcion_comercial
- clave_producto_servicio_sat
- clave_unidad_sat
- marca
- status (Pending/Validated)
- user_email

## Reglas operativas relevantes
- Si SKU ya existe en pendientes, se reutiliza en lugar de duplicar flujo inicial.
- En errores de IA, se devuelve tarjeta de error amigable para no romper experiencia.
- Hay endpoint de prueba con modelo de razonamiento (gpt-5-mini) para evaluar calidad de clasificacion.

## Riesgos operativos
- Rate limit en Azure OpenAI o Tavily puede degradar tiempos de respuesta.
- Credenciales de SAP o Dataverse invalidas bloquean integraciones secundarias.
- Entradas SKU ambiguas requieren validacion humana para asegurar calidad fiscal.

## Checklist de validacion
1. Verificar secretos de Azure OpenAI, Tavily, SAP y DYNAMIC_SECRET.
2. Probar /search con SKU conocido.
3. Probar ciclo /search-card -> /search/validate-card.
4. Confirmar persistencia y cambio de estado en ProductoPendienteValidation.
