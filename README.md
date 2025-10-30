
# AgentsCopilot - Cotizador

Endpoint principal:

- POST /agente/cotizador/generar

Flujo interactivo para casos con muchas coincidencias:

1) Cliente envía una solicitud con `solicitud` (texto) al endpoint POST /agente/cotizador/generar.
	- Si el motor devuelve pocos candidatos, la cotización se genera inmediatamente.
	- Si hay muchas coincidencias, la API responderá con un resumen `candidates` y `initialMatches` para que el cliente decida.

2) Cliente muestra los `candidates` al usuario y elige uno o varios índices.
	- El cliente envía una segunda petición POST /agente/cotizador/generar con el mismo `solicitud` y un campo `selection` que es un array: [{ index: <número>, quantity?: <número> }, ...]

3) El servidor generará la cotización usando las selecciones exactas y devolverá el resumen final, documento y (opcional) enviará por email.

Ejemplo de `selection`:

{
  "solicitud": "Dame 5 licencias Dynamics 365 Commerce",
  "cliente": { "nombre": "Juan", "email": "juan@example.com" },
  "selection": [ { "index": 2, "quantity": 5 }, { "index": 4, "quantity": 10 } ]
}

Este flujo permite al usuario desambiguar cuando hay múltiples productos con el mismo `SkuTitle` pero diferentes `SkuDescription` o `BillingPlan`.

Endpoints nuevos (resumen):

- POST /agente/cotizador/generar/candidates
	- Body: { "solicitud": "texto de búsqueda" }
	- Respuesta: { candidates: [{index,nombre,descripcion,billingPlan,precio}], initialMatches: N }

- POST /agente/cotizador/generar/seleccionar
	- Body: { "solicitud": "texto", "cliente": {...}, "selection": [{"index": <n>, "quantity": <m>} ] }
	- Genera la cotización usando los índices elegidos y devuelve el resumen/documento.

Ejemplo discovery (candidates):

Request:
{
	"solicitud": "Dynamics 365 Commerce"
}

Response:
{
	"candidates": [ { "index": 0, "nombre": "Dynamics 365 Commerce - Standard", "descripcion": "POS + e-commerce", "billingPlan": "Monthly", "precio": 123.45 }, ... ],
	"initialMatches": 20
}

Ejemplo selección y cotización:

Request:
{
	"solicitud": "Dame 5 licencias Dynamics 365 Commerce",
	"cliente": { "nombre": "Juan", "email": "juan@example.com" },
	"selection": [ { "index": 2, "quantity": 5 } ]
}

Response: resumen con productos, totales y documento generado.


