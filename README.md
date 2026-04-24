
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

## Pruebas hudspot

Endpoint de ejemplo para registrar intereses comerciales y disparar un correo ejecutivo a `abraham.pardo@compucad.com.mx`.

- Ruta: `POST /agente/pruebas-hudspot/interes`
- Autenticacion propia: `TokenHudspot`
  Debe enviarse en el header `x-hudspot-token`.

Ejemplo:

```json
{
  "interes": "Necesito una licencia de Copilot para 20 usuarios",
  "nombreCliente": "Cliente Demo"
}
```

Header requerido:

```text
x-hudspot-token: Guoi6aqThzGWo3TYzm9HWfYYJq
```

Comportamiento:

- Detecta si la necesidad apunta a `Microsoft Copilot`, `Adobe Firefly` o `Autodesk`.
- Genera una propuesta comercial en tono ejecutivo con IA y usa plantilla de respaldo si IA no responde.
- Envia el correo a `abraham.pardo@compucad.com.mx`.
- Devuelve contexto util para un agente de IA: marca detectada, preguntas de discovery, siguientes acciones y resumen de la propuesta.


