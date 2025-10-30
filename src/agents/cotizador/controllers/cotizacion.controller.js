import { ExcelService } from '../services/excel.service.js';
import { IAService } from '../services/ia.service.js';
import { DocumentService } from '../services/document.service.js';
import { EmailService } from '../services/email.service.js';
import { CandidatesService } from '../services/candidates.service.js';
import { successResponse, errorResponse } from '../../../shared/utils/response.js';
import { logger } from '../../../shared/utils/logger.js';

export class CotizacionController {
  static async generarCotizacion(req, res) {
    try {
      const { solicitud, cliente } = req.body;

      if (!solicitud) {
        return errorResponse(res, 'Se requiere el campo "solicitud"', 400);
      }

      logger.info('Generando cotización', { solicitud });

      // 1. Leer productos
      const todosProductos = ExcelService.leerTodosLosProductos();

      // 2. Buscar productos relevantes con IA
      const resultadoIA = await IAService.buscarProductosRelevantes(
        solicitud,
        todosProductos
      );

      // resultadoIA puede contener: { productos: Array, tokens: {...}, raw: string }
      let productosSeleccionados = Array.isArray(resultadoIA?.productos)
        ? resultadoIA.productos
        : [];

      // Si hay más coincidencias (initialMatchesCount) que candidatos enviados, devolvemos un resumen para que el usuario elija
      const initialMatches = resultadoIA?.initialMatchesCount || 0;
      const candidates = resultadoIA?.candidates || [];

      // Si el cliente envía una selección explícita en el body (selection: [{index, quantity?}]) la respetamos
      const selectionFromUser = req.body.selection;
      if (Array.isArray(selectionFromUser) && selectionFromUser.length > 0) {
        // Construir productosSeleccionados basados en los índices enviados
        productosSeleccionados = selectionFromUser.map(sel => {
          const cand = candidates[sel.index];
          if (!cand) return null;
          const prod = { ...cand.producto };
          prod.cantidad = sel.quantity ?? sel.qty ?? sel.quantity ?? 1;
          prod.quantity = prod.cantidad;
          return prod;
        }).filter(Boolean);
      } else if (initialMatches > (candidates?.length || 0) && (!productosSeleccionados || productosSeleccionados.length === 0)) {
        // Hay muchas coincidencias y no hay selección: devolver resumen de candidates para que el usuario elija
        return successResponse(res, { candidates, initialMatches }, 'Se encontraron múltiples coincidencias, selecciona índices para continuar');
      }

      if (productosSeleccionados.length === 0) {
        return errorResponse(res, 'No se encontraron productos relevantes', 404);
      }

      // 3. Generar documento Word
      const docPath = DocumentService.generarCotizacion(
        productosSeleccionados, 
        cliente || {}
      );

      // 4. Enviar por correo si se proporcionó email
      let correoEnviado = false;
      if (cliente?.email) {
        await EmailService.enviarCotizacion(cliente.email, docPath);
        correoEnviado = true;

        // Eliminar el archivo después de enviarlo por correo
        try {
          const fs = await import('fs');
          if (fs.existsSync(docPath)) {
            fs.unlinkSync(docPath);
            logger.info('Archivo de cotización eliminado después de envío por correo', { docPath });
          }
        } catch (error) {
          logger.warn('Error al eliminar archivo de cotización', { docPath, error: error.message });
        }
      }

      // 5. Preparar resumen
      const subtotal = productosSeleccionados.reduce(
        (sum, p) => sum + (p.precio * (p.quantity ?? p.cantidad ?? 1)),
        0
      );
      const iva = subtotal * 0.16;
      const totalCotizacion = subtotal + iva;

      const resumen = {
        productos: productosSeleccionados.map(p => ({
          nombre: p.nombre,
          precio: p.precio,
          cantidad: p.quantity ?? p.cantidad ?? 1
        })),
        totalProductos: productosSeleccionados.length,
        subtotal: subtotal,
        iva: iva,
        totalCotizacion: totalCotizacion,
        documentoGenerado: true,
        correoEnviado,
        tokens: resultadoIA?.tokens || null
      };

      logger.info('Cotización generada exitosamente', resumen);
      
      return successResponse(res, resumen, 'Cotización generada exitosamente');

    } catch (error) {
      logger.error('Error al generar cotización', error);
      return errorResponse(res, error.message, 500);
    }
  }

  // Nuevo: endpoint para obtener candidates/resumen para una solicitud (discovery)
// controllers/cotizacion.controller.js

// controllers/cotizacion.controller.js


// controllers/cotizacion.controller.js

static async descubrirProductos(req, res) {
  try {
    const { solicitud } = req.body;
    if (!solicitud) return errorResponse(res, 'Se requiere el campo "solicitud"', 400);

    // 1) Cargar catálogo y pedir relevancia a IA/scoreo
    const todosProductos = ExcelService.leerTodosLosProductos();
    const resultadoIA = await IAService.buscarProductosRelevantes(solicitud, todosProductos);

    // 2) Normalizar resultados base
    const candidates = resultadoIA?.candidates || [];
    const initialMatches = resultadoIA?.initialMatchesCount || candidates.length || 0;
    const tokens = resultadoIA?.tokens ?? null; // <- se agrega al JSON (NO a la tarjeta)

    // === Helpers ===
    const fmtMoney = (v, curr = 'USD') => {
      if (typeof v !== 'number' || !isFinite(v)) return 's/p';
      try {
        return new Intl.NumberFormat('es-MX', { style: 'currency', currency: curr }).format(v);
      } catch {
        const n = Number.isFinite(v) ? v.toFixed(2) : String(v);
        return `${curr} ${n}`;
      }
    };
    const humanizeTerm = (iso) => {
      if (!iso || typeof iso !== 'string') return '';
      // Soporta P1Y, P12M, P30D, etc.
      const m = iso.match(/^P(\d+)([YMD])$/i);
      if (!m) return iso;
      const n = Number(m[1]);
      const u = m[2].toUpperCase();
      const map = { Y: n === 1 ? 'año' : 'años', M: n === 1 ? 'mes' : 'meses', D: n === 1 ? 'día' : 'días' };
      return `${n} ${map[u] || ''}`.trim();
    };
    const trimDesc = (s, n = 240) => {
      if (!s) return '';
      const t = String(s).replace(/\s+/g, ' ').trim();
      return t.length > n ? `${t.slice(0, n - 1)}…` : t;
    };
    const read = (c, field) => c?.[field]; // candidatos ya están "planos"

    // === Construcción de la Adaptive Card ===
    const list = candidates.slice(0, Math.max(10, candidates.length)); // mostrar mínimo 10 candidatos o todos si hay menos

    const cardBody = [];

    // Encabezado
    cardBody.push({
      type: "Container",
      style: "emphasis",
      items: [
        { type: "TextBlock", text: "🧾 Resumen de tu solicitud", weight: "Bolder", size: "Large", wrap: true },
        { type: "TextBlock", text: `“${solicitud}”`, wrap: true }
      ]
    });

    // Texto de contexto (cuántos encontró)
    if (candidates.length > 0) {
      cardBody.push({
        type: "TextBlock",
        text: `🔎 Encontré ${initialMatches} candidatos. Aquí tienes ${list.length} opciones:`,
        wrap: true,
        spacing: "Medium"
      });
    } else {
      cardBody.push({
        type: "TextBlock",
        text: "😕 No encontré coincidencias. Prueba especificando producto, cantidad y (si aplica) plan/duración.",
        wrap: true,
        spacing: "Medium"
      });
    }

    // Renglones por candidato (1-based)
    list.forEach((c, pos) => {
      const numero = String(pos + 1); // 1-based en la UI
      const nombre = read(c, 'nombre') || '—';
      const plan   = c?.planFacturacion || c?.billingPlan || '—';
      const termH  = humanizeTerm(read(c, 'duracionTermino')) || '';
      const curr   = read(c, 'moneda') || 'USD';
      const precio = (typeof c?.precio === 'number') ? fmtMoney(c.precio, curr) : 's/p';
      const sku    = read(c, 'sku') || '';
      const id     = read(c, 'id') || '';
      const fab    = read(c, 'fabricante') || '';
      const mkt    = read(c, 'mercado') || '';
      const seg    = read(c, 'segmento') || '';
      const desc   = trimDesc(read(c, 'descripcion'));

      const titulo = `${nombre}${plan && plan !== '—' ? ` (${plan})` : ''}${termH ? ` · ${termH}` : ''}`;
      const priceLine = `💲 ${fmtMoney(c.precio ?? NaN, curr)} por unidad`;

      // Construimos dinámicamente las líneas opcionales
      const optionalLines = [];

      // SKU / ID (mostrar solo si existe alguno; nunca mostrar “—”)
      const hasSku = !!sku?.trim();
      const hasId  = !!id?.trim();
      if (hasSku || hasId) {
        const parts = [];
        if (hasSku) parts.push(`🏷️ SKU: ${sku}`);
        if (hasId)  parts.push(`🆔 ID: ${id}`);
        optionalLines.push({
          type: "TextBlock",
          text: parts.join(" · "),
          isSubtle: true,
          wrap: true,
          spacing: "Small"
        });
      }

      // Fabricante (solo si hay dato)
      const hasFab = !!fab?.trim();
      if (hasFab) {
        optionalLines.push({
          type: "TextBlock",
          text: `🧩 Fabricante: ${fab}`,
          isSubtle: true,
          wrap: true,
          spacing: "None"
        });
      }

      // Mercado/Segmento (solo si hay alguno)
      const hasMkt = !!mkt?.trim();
      const hasSeg = !!seg?.trim();
      if (hasMkt || hasSeg) {
        const parts = [];
        if (hasMkt) parts.push(`🌎 Mercado: ${mkt}`);
        if (hasSeg) parts.push(`🎯 Segmento: ${seg}`);
        optionalLines.push({
          type: "TextBlock",
          text: parts.join(" · "),
          isSubtle: true,
          wrap: true,
          spacing: "None"
        });
      }

      // Descripción (si hay)
      if (desc) {
        optionalLines.push({
          type: "TextBlock",
          text: `📄 ${desc}`,
          wrap: true,
          spacing: "Small"
        });
      }

      cardBody.push({
        type: "Container",
        separator: true,
        spacing: "Medium",
        items: [
          {
            type: "ColumnSet",
            columns: [
              {
                type: "Column",
                width: "auto",
                items: [
                  { type: "TextBlock", text: numero, size: "ExtraLarge", weight: "Bolder", color: "Accent" }
                ]
              },
              {
                type: "Column",
                width: "stretch",
                items: [
                  { type: "TextBlock", text: titulo, weight: "Bolder", size: "Medium", wrap: true },
                  { type: "TextBlock", text: priceLine, weight: "Bolder", color: "Attention", wrap: true },
                  ...optionalLines
                ]
              }
            ]
          }
        ]
      });
    });

    // Pie sin instrucciones (removido por solicitud del usuario)

    // Tarjeta final (Adaptive Card 1.4)
    const uiAdaptiveCard = {
      type: "AdaptiveCard",
      version: "1.4",
      body: cardBody
      // Si necesitas $schema, puedes agregar:
      // $schema: "http://adaptivecards.io/schemas/adaptive-card.json"
    };

    // 4) Persistir sesión para selección posterior
    const sessionId = CandidatesService.storeCandidates(candidates, solicitud, tokens || null);

    // 5) Responder (tokens arriba; tarjeta en uiMessage)
    return successResponse(
      res,
      {
        tokens,                 // 👈 primera propiedad en data
        sessionId,
        uiMessage: uiAdaptiveCard, // 👈 tarjeta Adaptive Card
        candidates,             // 👈 índices reales siguen 0-based para backend
        initialMatches,
        expiresIn: CandidatesService.SESSION_TTL
      },
      'Candidates generados'
    );
  } catch (error) {
    logger?.error?.('Error en descubrirProductos', error);
    return errorResponse(res, error.message, 500);
  }
}



  // Nuevo: endpoint para recibir selection en lenguaje natural y generar la cotización (selection: string)
  static async seleccionarYCotizar(req, res) {
    try {
      const { sessionId, cliente, selection } = req.body;
      if (!sessionId) return errorResponse(res, 'Se requiere un sessionId válido', 400);
      if (!selection || typeof selection !== 'string') return errorResponse(res, 'Se requiere selection (string en lenguaje natural)', 400);

      // Validar que el sessionId exista y obtener los candidates
      const sessionData = CandidatesService.getCandidates(sessionId);
      if (!sessionData) return errorResponse(res, 'Sesión inválida o expirada', 404);

      const { candidates, solicitud, tokens } = sessionData;

      // Parsear selection en lenguaje natural usando IA
      const parsedSelection = await IAService.parseSelectionWithAI(selection, candidates);
      if (!parsedSelection || parsedSelection.length === 0) {
        return errorResponse(res, 'No se pudo parsear la selección. Ejemplos: "3 licencias del índice 1 y 4 licencias del índice 3" o "2 del 1, 3 del 2"', 400);
      }

      logger.info('Selección parseada exitosamente', {
        selectionOriginal: selection,
        parsedSelection,
        totalProductosSeleccionados: parsedSelection.length
      });

      // Construir productosSeleccionados a partir de parsedSelection
      const productosSeleccionados = parsedSelection.map(sel => {
        const cand = candidates[sel.index];
        if (!cand) return null;
        const prod = { ...cand.producto };
        const cantidad = sel.quantity ?? sel.qty ?? 1;
        prod.cantidad = cantidad;
        prod.quantity = cantidad;
        return prod;
      }).filter(Boolean);

      if (productosSeleccionados.length === 0) return errorResponse(res, 'No se pudieron construir productos desde la selección en lenguaje natural. Verifica los números de productos.', 400);

      const docPath = DocumentService.generarCotizacion(productosSeleccionados, cliente || {});
      let correoEnviado = false;
      if (cliente?.email) {
        await EmailService.enviarCotizacion(cliente.email, docPath);
        correoEnviado = true;

        // Eliminar el archivo después de enviarlo por correo
        try {
          const fs = await import('fs');
          if (fs.existsSync(docPath)) {
            fs.unlinkSync(docPath);
            logger.info('Archivo de cotización eliminado después de envío por correo', { docPath });
          }
        } catch (error) {
          logger.warn('Error al eliminar archivo de cotización', { docPath, error: error.message });
        }
      }

      const subtotal = productosSeleccionados.reduce((sum, p) => sum + (p.precio * (p.quantity ?? p.cantidad ?? 1)), 0);
      const iva = subtotal * 0.16;
      const totalCotizacion = subtotal + iva;

      // Crear mensaje de confirmación en Adaptive Card
      const uiMessage = {
        type: "AdaptiveCard",
        version: "1.4",
        body: [
          {
            type: "Container",
            style: "emphasis",
            items: [
              { type: "TextBlock", text: "✅ Cotización Generada", weight: "Bolder", size: "Large", wrap: true },
              { type: "TextBlock", text: `Productos seleccionados: ${productosSeleccionados.length}`, wrap: true }
            ]
          },
          {
            type: "Container",
            separator: true,
            spacing: "Medium",
            items: productosSeleccionados.map((p, idx) => ({
              type: "TextBlock",
              text: `${idx + 1}. ${p.nombre} - Cantidad: ${p.quantity ?? p.cantidad ?? 1} - Precio: $${p.precio}`,
              wrap: true
            }))
          },
          {
            type: "Container",
            separator: true,
            spacing: "Medium",
            items: [
              { type: "TextBlock", text: `💰 Subtotal: $${subtotal.toFixed(2)}`, weight: "Bolder" },
              { type: "TextBlock", text: `🧾 IVA (16%): $${iva.toFixed(2)}`, weight: "Bolder" },
              { type: "TextBlock", text: `💰 Total: $${totalCotizacion.toFixed(2)}`, weight: "Bolder", color: "Attention" },
              { type: "TextBlock", text: correoEnviado ? "📧 Cotización enviada por correo" : "📄 Cotización generada (revisa tu bandeja de entrada)", wrap: true }
            ]
          }
        ]
      };

      const resumen = {
        productos: productosSeleccionados.map(p => ({ nombre: p.nombre, precio: p.precio, cantidad: p.quantity ?? p.cantidad ?? 1 })),
        totalProductos: productosSeleccionados.length,
        subtotal: subtotal,
        iva: iva,
        totalCotizacion: totalCotizacion,
        documentoGenerado: true,
        correoEnviado,
        tokens, // Tokens recuperados de la sesión
        uiMessage // Mensaje de confirmación en Adaptive Card
      };

      logger.info('Cotización generada desde selection', resumen);
      return successResponse(res, resumen, 'Cotización generada exitosamente (selection)');
    } catch (error) {
      logger.error('Error en seleccionarYCotizar', error);
      return errorResponse(res, error.message, 500);
    }
  }

  static async listarProductos(req, res) {
    try {
      const productos = ExcelService.leerTodosLosProductos();
      return successResponse(res, { productos });
    } catch (error) {
      logger.error('Error al listar productos', error);
      return errorResponse(res, error.message, 500);
    }
  }

  // Función para parsear selección en lenguaje natural (mantenida por compatibilidad)
  static parseNaturalLanguageSelection(text) {
    if (!text || typeof text !== 'string') return [];

    // Normalizar texto: minúsculas, quitar espacios extra
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();

    // Patrones comunes:
    // - "2 del 1, 3 del 2"
    // - "1x5 y 4x4"
    // - "4-3" (cantidad-producto)
    // - "dame 2 del numero 1. 3 del 2."

    const patterns = [
      // "2 del 1" o "2 de 1"
      /(\d+)\s*(?:del?|de)\s*(?:numero|n[úu]mero)?\s*(\d+)/g,
      // "1x5" o "1 x 5"
      /(\d+)\s*x\s*(\d+)/g,
      // "4-3" (cantidad-producto)
      /(\d+)\s*-\s*(\d+)/g
    ];

    const selections = [];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(normalized)) !== null) {
        const quantity = parseInt(match[1], 10);
        const index = parseInt(match[2], 10) - 1; // Convertir a 0-based

        if (quantity > 0 && index >= 0) {
          selections.push({ index, quantity });
        }
      }
    }

    // Eliminar duplicados por index (última cantidad gana)
    const uniqueSelections = selections.reduce((acc, sel) => {
      acc[sel.index] = sel;
      return acc;
    }, {});

    return Object.values(uniqueSelections);
  }
}