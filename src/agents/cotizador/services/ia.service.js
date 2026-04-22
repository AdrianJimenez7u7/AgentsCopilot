export class IAService {
  static async buscarProductosRelevantes(solicitud, todosProductos) {
    // Mejor pre-filtrado: buscar coincidencias en minúsculas por frase completa y por palabras
    const normalize = s => (s || '').toString().toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ');
    const solicitudNorm = normalize(solicitud);
    const palabras = solicitudNorm.split(/\s+/).filter(w => w.length >= 3);
    
    // Detectar si la solicitud parece contener múltiples productos
    const indicadoresMultiples = [' y ', ' y', 'y ', ',', ';', 'además', 'también', 'más'];
    const tieneMultiplesProductos = indicadoresMultiples.some(ind => solicitudNorm.includes(ind));
    
    // Definir palabras genéricas que pueden causar falsos positivos
    const palabrasGenericas = ['microsoft', '365', 'office', 'windows', 'azure', 'teams'];
    const palabrasEspecificas = palabras.filter(w => !palabrasGenericas.includes(w));
    
    // console.log('🔍 Análisis de solicitud:', {
    //   solicitud: solicitud,
    //   tieneMultiplesProductos,
    //   indicadoresEncontrados: indicadoresMultiples.filter(ind => solicitudNorm.includes(ind)),
    //   palabrasGenericas: palabras.filter(w => palabrasGenericas.includes(w)),
    //   palabrasEspecificas: palabrasEspecificas
    // });
    
    // Debug: buscar productos que contengan palabras específicas
    // console.log('🔎 Búsqueda de productos con palabras específicas:');
    palabrasEspecificas.forEach(palabra => {
      const productosConPalabra = todosProductos.filter(p => 
        normalize(p.nombre).includes(palabra) || 
        normalize(p.descripcion).includes(palabra) || 
        normalize(p.sku).includes(palabra)
      );
      // console.log(`  "${palabra}": ${productosConPalabra.length} productos encontrados`);
      if (productosConPalabra.length > 0) {
        // console.log(`    Ejemplos: ${productosConPalabra.slice(0, 3).map(p => p.nombre).join(', ')}`);
      }
    });
    
    // Debug específico para SharePoint
    if (solicitudNorm.includes('sharepoint')) {
      // console.log('🔍 Debug específico para SharePoint:');
      const productosSharePoint = todosProductos.filter(p => 
        normalize(p.nombre).includes('sharepoint') || 
        normalize(p.descripcion).includes('sharepoint') || 
        normalize(p.sku).includes('sharepoint')
      );
      // console.log(`  Productos con "sharepoint": ${productosSharePoint.length}`);
      productosSharePoint.slice(0, 5).forEach((p, idx) => {
        // console.log(`    ${idx + 1}. ${p.nombre} (SKU: ${p.sku})`);
      });
      
      // Debug de scoring para productos de SharePoint
      // console.log('🎯 Debug de scoring para productos SharePoint:');
      productosSharePoint.slice(0, 3).forEach(p => {
        const nombre = normalize(p.nombre);
        const descripcion = normalize(p.descripcion);
        const sku = normalize(p.sku);
        let score = 0;
        
        // Aplicar la misma lógica de scoring
        if (nombre.includes(solicitudNorm) || descripcion.includes(solicitudNorm)) {
          score += 10;
        }
        
        for (const w of palabrasEspecificas) {
          if (nombre.includes(w)) score += 4;
          if (descripcion.includes(w)) score += 2;
          if (sku.includes(w)) score += 4;
        }
        
        for (const w of palabrasGenericas) {
          if (palabras.includes(w)) {
            if (nombre.includes(w)) score += 1;
            if (descripcion.includes(w)) score += 0.5;
            if (sku.includes(w)) score += 1;
          }
        }
        
        // console.log(`    ${p.nombre}: score = ${score}`);
      });
    }

    // Calcular score para cada producto
    const scored = todosProductos.map((p, idx) => {
      const nombre = normalize(p.nombre);
      const descripcion = normalize(p.descripcion);
      const sku = normalize(p.sku);
      let score = 0;

      // Coincidencia de frase completa (máxima prioridad)
      if (nombre.includes(solicitudNorm) || descripcion.includes(solicitudNorm)) {
        score += 10; // Aumentado para dar más peso a coincidencias exactas
      }

      // Scoring específico para palabras no genéricas (alta prioridad)
      for (const w of palabrasEspecificas) {
        if (nombre.includes(w)) score += 6; // Aumentado para dar más peso al nombre
        if (descripcion.includes(w)) score += 1; // Reducido para descripción
        if (sku.includes(w)) score += 6; // Aumentado para dar más peso al SKU
      }

      // Scoring para palabras genéricas (menor prioridad)
      for (const w of palabrasGenericas) {
        if (palabras.includes(w)) { // Solo si la palabra genérica está en la solicitud
          if (nombre.includes(w)) score += 1; // Reducido
          if (descripcion.includes(w)) score += 0.5; // Reducido
          if (sku.includes(w)) score += 1; // Reducido
        }
      }

      // Penalizar productos que solo coinciden por palabras genéricas
      // PERO solo si hay palabras específicas en la solicitud
      if (palabrasEspecificas.length > 0) {
        const tieneCoincidenciasEspecificas = palabrasEspecificas.some(w => 
          nombre.includes(w) || descripcion.includes(w) || sku.includes(w)
        );
        
        if (!tieneCoincidenciasEspecificas) {
          score *= 0.1; // Reducir aún más el score para eliminar falsos positivos
          // console.log(`⚠️ Producto penalizado por solo coincidencias genéricas: ${p.nombre} (score: ${score.toFixed(2)})`);
        }
      }

      // Penalizar productos que contienen palabras conflictivas (como Dynamics cuando se busca Copilot)
      const palabrasConflictivas = ['dynamics', 'contact center', 'customer service'];
      const tienePalabrasConflictivas = palabrasConflictivas.some(conflictiva => 
        nombre.toLowerCase().includes(conflictiva) || 
        descripcion.toLowerCase().includes(conflictiva) || 
        sku.toLowerCase().includes(conflictiva)
      );
      
      // Solo penalizar si el producto tiene palabras conflictivas PERO no tiene coincidencias específicas en el nombre/SKU
      if (tienePalabrasConflictivas) {
        const tieneCoincidenciasEspecificasEnNombreOSku = palabrasEspecificas.some(w => 
          nombre.includes(w) || sku.includes(w)
        );
        
        if (!tieneCoincidenciasEspecificasEnNombreOSku) {
          score *= 0.05; // Penalización muy severa
          // console.log(`🚫 Producto penalizado por palabras conflictivas: ${p.nombre} (score: ${score.toFixed(2)})`);
        }
      }

      // Bonus por coincidencias múltiples de palabras específicas
      const coincidenciasEspecificas = palabrasEspecificas.filter(w => 
        nombre.includes(w) || descripcion.includes(w) || sku.includes(w)
      ).length;
      
      if (coincidenciasEspecificas > 1) {
        score += coincidenciasEspecificas * 2; // Bonus por múltiples coincidencias específicas
      }

      // Si detectamos múltiples productos, ser más permisivo con el scoring
      if (tieneMultiplesProductos) {
        // Agregar puntos por coincidencias parciales solo para palabras específicas
        for (const w of palabrasEspecificas) {
          if (nombre.includes(w.substring(0, Math.max(3, w.length - 2)))) score += 1;
          if (descripcion.includes(w.substring(0, Math.max(3, w.length - 2)))) score += 0.5;
        }
      }

      // Penalizar productos sin nombre
      if (!p.nombre) score -= 1;

      return { producto: p, idx, score };
    });

    // Filtrar por score positivo y ordenar desc; si ninguno tiene score>0, usar búsqueda por contains simple
    // Ajustar umbral dinámicamente para múltiples productos
    const umbralMinimo = tieneMultiplesProductos ? 2.0 : 1.0; // umbral más alto para evitar falsos positivos
    let productosRelevantes = scored.filter(s => s.score > umbralMinimo).sort((a,b) => b.score - a.score);
    
    // Mostrar top 10 productos con sus scores para debug
    const topProductos = productosRelevantes.slice(0, 10);
    // console.log('🏆 Top productos encontrados:');
    topProductos.forEach((item, idx) => {
      // console.log(`${idx + 1}. ${item.producto.nombre} - Score: ${item.score.toFixed(2)}`);
    });
    
    // Mostrar todos los productos con score > 0 para debug completo
    const todosConScore = scored.filter(s => s.score > 0).sort((a,b) => b.score - a.score);
    // console.log(`\n📊 Total productos con score > 0: ${todosConScore.length}`);
    if (todosConScore.length > 0) {
      // console.log('📋 Todos los productos con score positivo:');
      todosConScore.forEach((item, idx) => {
        // console.log(`${idx + 1}. ${item.producto.nombre} - Score: ${item.score.toFixed(2)}`);
      });
    }
    
    if (productosRelevantes.length === 0) {
      // console.log('⚠️ No se encontraron productos con score positivo, usando fallback...');
      // fallback: buscar por inclusión de la frase completa o alguna palabra
      productosRelevantes = scored.filter(s => {
        const nombre = normalize(s.producto.nombre);
        const descripcion = normalize(s.producto.descripcion);
        return nombre.includes(solicitudNorm) || descripcion.includes(solicitudNorm) || palabras.some(w => nombre.includes(w) || descripcion.includes(w));
      }).sort((a,b) => b.score - a.score);
      // console.log(`🔄 Fallback encontró ${productosRelevantes.length} productos`);
    }

    // Tomar top N candidatos y deduplicar por SKU/nombre para evitar ruido y repeticiones
    // Ajustar límites dinámicamente si detectamos múltiples productos
    const TOP_CANDIDATES = tieneMultiplesProductos ? 150 : 100; // más candidatos si hay múltiples productos
    const MAX_UNIQUE_CANDIDATES = tieneMultiplesProductos ?
      Math.max(10, Number(process.env.MAX_UNIQUE_CANDIDATES) || 75) : // mínimo 10, más únicos si hay múltiples productos
      Math.max(10, Number(process.env.MAX_UNIQUE_CANDIDATES) || 50);
    
    // console.log('📊 Límites ajustados:', {
    //   TOP_CANDIDATES,
    //   MAX_UNIQUE_CANDIDATES,
    //   razon: tieneMultiplesProductos ? 'múltiples productos detectados' : 'solicitud simple'
    // });

    // Tomar los top candidatos por score
    const candidatos = productosRelevantes.slice(0, TOP_CANDIDATES);

    // Deduplicar: conservar el producto con mayor score por sku (o por nombre si sku no disponible)
    // Pero ser menos agresivo para permitir más variedad de productos
    const uniqueMap = new Map(); // key -> {producto, score}
    for (const c of candidatos) {
      const p = c.producto;
      // Usar solo SKU para deduplicación, no nombre completo para permitir más variedad
      const key = (p.sku || '').toString().toLowerCase().trim();
      if (!key) {
        // Si no hay SKU, usar nombre pero ser más permisivo
        const nombreKey = (p.nombre || '').toString().toLowerCase().trim();
        if (!nombreKey) continue;
        // Solo deduplicar si el nombre es exactamente igual (no parcial)
        if (!uniqueMap.has(nombreKey)) {
          uniqueMap.set(nombreKey, { producto: p, score: c.score });
        }
        continue;
      }
      const existing = uniqueMap.get(key);
      if (!existing || c.score > existing.score) {
        uniqueMap.set(key, { producto: p, score: c.score });
      }
    }

    // Convertir a array preservando el orden de aparición por score
    const productosUnicos = Array.from(uniqueMap.values()).sort((a,b) => b.score - a.score).map(x => x.producto);

    // Limitar a los N únicos que queremos realmente consultar
    const productosAConsultar = productosUnicos.slice(0, MAX_UNIQUE_CANDIDATES);
    const initialMatchesCount = productosUnicos.length;

    const nombresProductos = productosAConsultar
        .map((p, idx) => {
          const raw = p._raw || {};
          const billingPlan = raw.BillingPlan || raw.Billing_Plan || raw.billing_plan || null;
          const skuDescription = raw.SkuDescription || raw.Sku_Description || raw.skuDescription || '';
          return `${idx}:${p.nombre}${skuDescription ? `\nDescripción: ${skuDescription}` : ''}${billingPlan ? `\nPlan: ${billingPlan}` : ''}\n`;
        })
        .join('\n');

    // Pedimos al modelo que devuelva un array JSON. Preferimos un array de objetos
    // con { index, quantity, billingPlan? } para capturar cantidades solicitadas.
    // Si el modelo sólo devuelve índices (compatibilidad), lo soportamos también.
      const prompt = `Productos disponibles:\n${nombresProductos}\nSolicitud del cliente:"${solicitud}"\n
  Instrucciones: Analiza la solicitud y los productos disponibles, teniendo en cuenta:
  1. El nombre del producto
  2. La descripción del SKU que proporciona detalles adicionales
  3. El plan de facturación (Monthly/Annual) si está especificado

  IMPORTANTE: Si la solicitud menciona MÚLTIPLES productos diferentes, debes devolver TODOS los productos solicitados.
  Por ejemplo, si piden "5 licencias de Copilot y 4 licencias de SharePoint", debes devolver ambos productos.

  Devuelve SOLO un JSON con un array de objetos que tengan esta estructura:
  {
    "index": <número del producto>,
    "quantity": <cantidad solicitada>,
    "billingPlan": <"Monthly"|"Annual"|null>  // Especifica el plan solo si está claro en la solicitud
  }

  Por ejemplo:
  [
    {"index": 0, "quantity": 20, "billingPlan": "Annual"},
    {"index": 3, "quantity": 50}
  ]

  Si la solicitud menciona un plan específico (mensual o anual), selecciona los productos que coincidan con ese plan.
  Si no hay cantidades explícitas en la solicitud, usa 1 como cantidad por defecto.
  No incluyas explicaciones ni texto adicional.`;

    // DEBUG: mostrar los productos que se enviarán en el prompt (lista reducida)
    try {
      // console.log('DEBUG - productosAConsultar (a enviar):', productosAConsultar.map((p,i)=> ({ i, nombre: p.nombre, precio: p.precio, archivo: p.archivo })));
    } catch (e) {
      console.error('DEBUG - error al imprimir productosAConsultar', e.message);
    }

    // Build payload matching the Azure REST API example
    const payload = {
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 500, // Aumentado para permitir múltiples productos
      temperature: 0.3,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      model: 'gpt-4.1-nano'
    };

    const AZURE_API_KEY = process.env.AZURE_API_KEY || '';
    if (!AZURE_API_KEY) {
      throw new Error('AZURE_API_KEY no configurada en el entorno');
    }

    // Use global fetch (Node 18+). Send api-key header as Azure expects.
    const url = 'https://ia-generativa.openai.azure.com/openai/deployments/gpt-4.1-nano/chat/completions?api-version=2025-01-01-preview';
    let resp;
    try {
        // console.log('Enviando solicitud a Azure OpenAI prompt enviado' + prompt);
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': AZURE_API_KEY
        },
        body: JSON.stringify(payload),
        // keep redirects default; timeout not natively supported on fetch in Node, can be added via AbortController if needed
      });
    } catch (err) {
      throw new Error(`Error de red al llamar a Azure OpenAI: ${err.message || err}`);
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Azure OpenAI responded ${resp.status} ${resp.statusText}: ${text}`);
    }

    const data = await resp.json();
    // Support both possible response shapes: choices[0].message.content or choices[0].content
    let contenido = (data.choices?.[0]?.message?.content ?? data.choices?.[0]?.content ?? '').trim();

    // Limpieza: eliminar fences de código y backticks y texto previa o posterior
    // Ejemplos que queremos soportar:
    // ```json\n[1,2,3]\n```
    // `[1,2,3]`
    // respuesta: [1,2,3]
    contenido = contenido.replace(/```[\s\S]*?```/g, match => {
      // si el fence contiene un array JSON, extraer el interior
      const inner = match.replace(/```\s*json\s*/i, '').replace(/```/g, '');
      return inner;
    }).replace(/`/g, '');

    // Buscar el primer array JSON en el texto con regex (puede ser array de índices o array de objetos)
    const arrayMatch = contenido.match(/\[([\s\S]*?)\]/);

    let parsedResult = [];
    if (arrayMatch) {
      let candidate = arrayMatch[0];
      // Intentos progresivos de parseo para manejar respuestas truncadas o con comas sobrantes
      try {
        parsedResult = JSON.parse(candidate);
      } catch (e1) {
        // 1) Intentar añadir corchete de cierre por si la respuesta fue truncada
        try {
          parsedResult = JSON.parse(candidate + ']');
        } catch (e2) {
          // 2) Intentar limpiar comas antes del cierre
          const cleaned1 = candidate.replace(/,\s*\]/g, ']');
          try {
            parsedResult = JSON.parse(cleaned1);
          } catch (e3) {
            // 3) Extraer objetos individuales { ... } y parsearlos por separado
            const objs = candidate.match(/\{[\s\S]*?\}/g) || [];
            parsedResult = objs.map(s => {
              try { return JSON.parse(s); } catch (e4) { return null; }
            }).filter(Boolean);

            if (parsedResult.length === 0) {
              // Como último recurso, intentar limpiar caracteres no válidos y parsear
              const cleaned2 = candidate.replace(/[^0-9{}\[\]:",.\-\s]/g, '');
              try { parsedResult = JSON.parse(cleaned2); } catch (e5) { parsedResult = []; }
            }
          }
        }
      }
    } else {
      // No se encontró un array; intentar parsear todo el contenido como JSON
      try {
        parsedResult = JSON.parse(contenido);
      } catch (e) {
        // Extraer objetos independientes { ... } y parsearlos
        const objs = contenido.match(/\{[\s\S]*?\}/g) || [];
        parsedResult = objs.map(s => {
          try { return JSON.parse(s); } catch (e2) { return null; }
        }).filter(Boolean);
      }
    }

    // Obtener y mostrar el uso de tokens
    const tokensUsados = {
      prompt_tokens: data.usage?.prompt_tokens || 0,
      completion_tokens: data.usage?.completion_tokens || 0,
      total_tokens: data.usage?.total_tokens || 0
    };

    // console.log('\nUso de tokens en esta consulta:');
    // console.log('--------------------------------');
    // console.log(`Tokens del prompt: ${tokensUsados.prompt_tokens}`);
    // console.log(`Tokens de la respuesta: ${tokensUsados.completion_tokens}`);
    // console.log('--------------------------------\n');

    // Normalize parsedResult into array of objects {index, quantity, billingPlan?}
    // console.log('\nRespuesta parseada del modelo:', Array.isArray(parsedResult) ? `items=${parsedResult.length}` : typeof parsedResult);
    //imprime contenido 
    // console.log('\nContenido recibido del modelo:', contenido);
    // console.log('\nResultado parseado:', JSON.stringify(parsedResult, null, 2));
    
    // Debug adicional para detectar respuestas truncadas
    // if (contenido.length > 0 && !contenido.includes(']')) {
    //   console.log('⚠️ ADVERTENCIA: La respuesta parece estar truncada (no contiene corchete de cierre)');
    // }
    // if (Array.isArray(parsedResult) && parsedResult.length === 1 && solicitud.toLowerCase().includes(' y ')) {
    //   console.log('⚠️ ADVERTENCIA: Solo se encontró 1 producto pero la solicitud parece contener múltiples productos');
    // }
    
    const normalizedItems = [];
    if (Array.isArray(parsedResult)) {
      for (const item of parsedResult) {
        // console.log('\nProcesando item:', JSON.stringify(item, null, 2));
        
        if (typeof item === 'number') {
          // console.log('Item es número, asignando cantidad 1');
          normalizedItems.push({ index: Number(item), quantity: 1 });
        } else if (typeof item === 'object' && item !== null) {
          const idx = Number(item.index ?? item.i ?? item.idx ?? item.id);
          const rawQty = item.quantity ?? item.qty ?? item.cantidad ?? 1;
          // console.log('Cantidad original:', rawQty, 'tipo:', typeof rawQty);
          
          let qty = Number(rawQty) || 1;
          // Clamp qty to a reasonable range to avoid accidental huge numbers
          if (qty < 1) qty = 1;
          if (qty > 100000) qty = 100000;
          
          // console.log('Cantidad después de procesar:', qty);
          
          const billingPlan = item.billingPlan || item.planFacturacion || item.plan || null;
          normalizedItems.push({ index: idx, quantity: qty, billingPlan });
          // console.log('Item normalizado añadido:', { index: idx, quantity: qty, billingPlan });
        }
      }
    }


// === Helpers locales ===
function getProductId(p) {
  const raw = p?._raw || {};
  return String(
    p?.id || raw.ProductId || raw.SkuId || raw.Sku || p?.sku || p?.nombre || ''
  ).trim().toLowerCase();
}

// === Construcción de candidates para TODOS los productos únicos encontrados (para discovery) ===
const map = new Map(); // productId -> candidate

for (const p of productosUnicos) {
  if (!p) continue;
  const pid = getProductId(p);
  if (!pid) continue;        // si no se puede identificar, saltar
  if (map.has(pid)) continue; // ya existe este producto, saltar duplicado

  const raw = p._raw || {};
  const productoLimpio = {
    id: p.id || raw.ProductId || raw.SkuId || raw.Sku || '',
    nombre: p.nombre || raw.ProductTitle || raw.SkuTitle || '',
    sku: p.sku || raw.Sku || raw.SkuId || '',
    fabricante: p.fabricante || raw.Publisher || '',
    precio: p.precio ?? raw.UnitPrice ?? null,
    moneda: p.moneda || raw.Currency || '',
    mercado: p.mercado || raw.Market || '',
    duracionTermino: p.duracionTermino || raw.TermDuration || '',
    planFacturacion: p.planFacturacion || raw.BillingPlan || '',
    categoria: p.categoria || raw.Tags || '',
    segmento: p.segmento || raw.Segment || ''
  };

  const candidate = {
    index: map.size,
    nombre: p.nombre,
    descripcion:
      raw.SkuDescription ||
      raw.Sku_Description ||
      raw.skuDescription ||
      p.descripcion ||
      '',
    billingPlan:
      raw.BillingPlan || raw.Billing_Plan || raw.billing_plan || null,
    precio: p.precio ?? null,
    producto: productoLimpio
  };
  map.set(pid, candidate);
}

// Convertimos el Map a arreglo final (TODOS los candidatos encontrados)
const allCandidates = Array.from(map.values());

// === Construcción de candidates solo para los productos que la IA procesó (para compatibilidad) ===
const selectedMap = new Map(); // productId -> candidate

for (const p of productosAConsultar) {
  if (!p) continue;
  const pid = getProductId(p);
  if (!pid) continue;
  if (selectedMap.has(pid)) continue;

  const raw = p._raw || {};
  const productoLimpio = {
    id: p.id || raw.ProductId || raw.SkuId || raw.Sku || '',
    nombre: p.nombre || raw.ProductTitle || raw.SkuTitle || '',
    sku: p.sku || raw.Sku || raw.SkuId || '',
    fabricante: p.fabricante || raw.Publisher || '',
    precio: p.precio ?? raw.UnitPrice ?? null,
    moneda: p.moneda || raw.Currency || '',
    mercado: p.mercado || raw.Market || '',
    duracionTermino: p.duracionTermino || raw.TermDuration || '',
    planFacturacion: p.planFacturacion || raw.BillingPlan || '',
    categoria: p.categoria || raw.Tags || '',
    segmento: p.segmento || raw.Segment || ''
  };

  const candidate = {
    index: selectedMap.size,
    nombre: p.nombre,
    descripcion:
      raw.SkuDescription ||
      raw.Sku_Description ||
      raw.skuDescription ||
      p.descripcion ||
      '',
    billingPlan:
      raw.BillingPlan || raw.Billing_Plan || raw.billing_plan || null,
    precio: p.precio ?? null,
    producto: productoLimpio
  };
  selectedMap.set(pid, candidate);
}

const candidates = Array.from(selectedMap.values());

// console.log(
//   `📊 Candidatos tras dedupe por producto: ${candidates.length} (original: ${productosAConsultar.length})`
// );

    // Map to products with quantity
    // console.log('\nItems normalizados antes de mapear:', JSON.stringify(normalizedItems, null, 2));
    let productosEncontrados = normalizedItems.map(it => {
      // Usar el índice de candidates (después de deduplicación) en lugar del índice original
      const candidateIndex = Number(it.index);
      if (candidateIndex >= candidates.length) {
        // console.log(`⚠️ Índice ${candidateIndex} fuera de rango de candidates (${candidates.length})`);
        return null;
      }
      
      const candidate = candidates[candidateIndex];
      if (!candidate) {
        // console.log(`⚠️ No se encontró candidate para el índice ${candidateIndex}`);
        return null;
      }
      
      const p = candidate.producto;
      
      const cantidad = Number(it.quantity);
      // console.log(`\nMapeando producto "${p.nombre}":`, {
      //   indice: it.index,
      //   cantidadOriginal: it.quantity,
      //   cantidadNormalizada: cantidad,
      //   tipoCantidad: typeof it.quantity
      // });
      
      const copy = { ...p, quantity: cantidad };
      if (it.billingPlan) copy.requestedBillingPlan = it.billingPlan;
      return copy;
    }).filter(Boolean);
    
    // Debug final de productos y cantidades
    // console.log('\nProductos encontrados finales:');
    productosEncontrados.forEach(p => {
      // console.log(`- ${p.nombre}: cantidad = ${p.quantity} (tipo: ${typeof p.quantity})`);
    });

    // Deduplicar por nombre para evitar entradas repetidas si el modelo repite índices
    const seen = new Set();
    productosEncontrados = productosEncontrados.filter(p => {
      const key = (p.nombre || '').toString();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Función auxiliar para parsear precios
    const parsePrice = (value) => {
      if (value == null) return 0;
      if (typeof value === 'number') return value;
      // Eliminar símbolos de moneda y comas, mantener puntos decimales
      const cleaned = value.toString().replace(/[^0-9.,-]/g, '').replace(/,/g, '');
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? 0 : parsed;
    };

    // Fallback de precio: intentar obtener de todas las fuentes posibles
    productosEncontrados = productosEncontrados.map(p => {
      const copy = { ...p };
      
      // Si ya tiene un precio válido, mantenerlo
      if (copy.precio && copy.precio > 0) {
        return copy;
      }

      // Intentar obtener el precio de todas las fuentes posibles
      const raw = copy._raw || {};
      const candidates = [
        raw.UnitPrice,
        raw.Unit_Price,
        raw.Price,
        raw.UnitPriceFormatted,
        raw['Unit Price'],
        raw.price,
        raw.unit_price,
        copy.precio // también intentar parsear el precio actual
      ];

      for (const candidate of candidates) {
        const parsed = parsePrice(candidate);
        if (parsed > 0) {
          copy.precio = parsed;
          // console.log(`Debug - Precio encontrado para ${copy.nombre}:`, {
          //   sourceValue: candidate,
          //   parsedPrice: parsed
          // });
          break;
        }
      }

      if (!copy.precio || copy.precio === 0) {
        // console.log(`⚠️ No se pudo encontrar precio válido para: ${copy.nombre}`);
        // console.log('Raw data disponible:', raw);
      }

      return copy;
    });

    // Resumen conciso: contar encontrados y advertir si alguno sin precio
    const encontradosSinPrecio = productosEncontrados.filter(p => !p.precio || p.precio === 0).length;
    // console.log(`\nResumen búsqueda IA: productos encontrados = ${productosEncontrados.length}, sin precio = ${encontradosSinPrecio}`);

    return {
      productos: productosEncontrados,
      tokens: tokensUsados,
      raw: contenido,
      indices: parsedResult,
      candidates: allCandidates, // devolver TODOS los candidatos encontrados
      initialMatchesCount
    };
  }

  static async parseSelectionWithAI(selectionText, candidates) {
    if (!selectionText || typeof selectionText !== 'string' || !Array.isArray(candidates)) {
      return [];
    }

    // Intentar primero con regex simple como fallback
    const regexResult = this.parseSelectionWithRegex(selectionText);
    if (regexResult.length > 0) {
      return regexResult;
    }

    // Si regex no funciona, usar IA

    // Si regex no funciona, usar IA
    // Crear lista de candidatos para el prompt
    const candidatesList = candidates.map((cand, idx) => {
      const nombre = cand.nombre || cand.producto?.nombre || 'Producto sin nombre';
      const precio = cand.precio || cand.producto?.precio || 'Precio no disponible';
      const sku = cand.sku || cand.producto?.sku || '';
      const fabricante = cand.fabricante || cand.producto?.fabricante || '';
      return `${idx + 1}. ${nombre}${sku ? ` (SKU: ${sku})` : ''}${fabricante ? ` - ${fabricante}` : ''} - Precio: ${precio}`;
    }).join('\n');

    const prompt = `Productos disponibles para selección:
${candidatesList}

Instrucción del usuario: "${selectionText}"

Instrucciones: Analiza la instrucción del usuario y extrae las selecciones de productos con sus cantidades.
El usuario puede usar lenguaje natural como:
- "3 licencias del índice 1 y 4 licencias del índice 3"
- "quiero 2 del producto 1 y 5 del 4"
- "selecciona el número 2 con cantidad 10 y el 5 con 3"
- "3 del 1, 4 del 2"
- "licencias: 2 del primero y 3 del tercero"

Devuelve SOLO un JSON array de objetos con esta estructura:
[
  {"index": <número del producto empezando desde 1>, "quantity": <cantidad solicitada>}
]

Ejemplos:
Para "3 del 1 y 4 del 2":
[{"index": 1, "quantity": 3}, {"index": 2, "quantity": 4}]

Para "2 licencias del índice 1":
[{"index": 1, "quantity": 2}]

Si no puedes identificar productos específicos, devuelve un array vacío [].`;

    const payload = {
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 300,
      temperature: 0.1, // Baja temperatura para consistencia
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      model: 'gpt-4.1-nano'
    };

    const AZURE_API_KEY = process.env.AZURE_API_KEY || '';
    if (!AZURE_API_KEY) {
      throw new Error('AZURE_API_KEY no configurada en el entorno');
    }

    const url = 'https://ia-generativa.openai.azure.com/openai/deployments/gpt-4.1-nano/chat/completions?api-version=2025-01-01-preview';

    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': AZURE_API_KEY
        },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      throw new Error(`Error de red al llamar a Azure OpenAI: ${err.message || err}`);
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Azure OpenAI responded ${resp.status} ${resp.statusText}: ${text}`);
    }

    const data = await resp.json();
    let contenido = (data.choices?.[0]?.message?.content ?? data.choices?.[0]?.content ?? '').trim();

    // Obtener tokens usados en esta consulta de selección
    const tokensUsadosSeleccion = {
      prompt_tokens: data.usage?.prompt_tokens || 0,
      completion_tokens: data.usage?.completion_tokens || 0,
      total_tokens: data.usage?.total_tokens || 0
    };

    // Limpiar respuesta
    contenido = contenido.replace(/```[\s\S]*?```/g, match => {
      const inner = match.replace(/```\s*json\s*/i, '').replace(/```/g, '');
      return inner;
    }).replace(/`/g, '');

    let parsedResult = [];
    try {
      parsedResult = JSON.parse(contenido);
    } catch (e) {
      // Intentar extraer array
      const arrayMatch = contenido.match(/\[[\s\S]*?\]/);
      if (arrayMatch) {
        try {
          parsedResult = JSON.parse(arrayMatch[0]);
        } catch (e2) {
          parsedResult = [];
        }
      } else {
        parsedResult = [];
      }
    }

    // Normalizar resultados (convertir índices a 0-based)
    const normalizedSelections = [];
    if (Array.isArray(parsedResult)) {
      for (const item of parsedResult) {
        if (typeof item === 'object' && item !== null) {
          const index = Number(item.index ?? item.i ?? item.idx) - 1; // Convertir a 0-based
          const quantity = Number(item.quantity ?? item.qty ?? item.cantidad ?? 1);

          if (index >= 0 && index < candidates.length && quantity > 0) {
            normalizedSelections.push({ index, quantity });
          }
        }
      }
    }

    // Eliminar duplicados por index (última cantidad gana)
    const uniqueSelections = normalizedSelections.reduce((acc, sel) => {
      acc[sel.index] = sel;
      return acc;
    }, {});

    return Object.values(uniqueSelections);
  }

  static parseSelectionWithRegex(text) {
    if (!text || typeof text !== 'string') return [];

    // Normalizar texto: minúsculas, quitar espacios extra
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();

    // Patrones mejorados:
    // - "3 licencias del índice 1" o "3 del índice 1"
    // - "2 del 1, 3 del 2"
    // - "1x5 y 4x4"
    // - "4-3" (cantidad-producto)
    // - "dame 2 del numero 1. 3 del 2."

    const patterns = [
      // "3 licencias del índice 1" o "3 del índice 1"
      /(\d+)\s*(?:licencias?|unidades?)?\s*(?:del?|de)\s*(?:índice|indice|numero|n[úu]mero|producto)?\s*(\d+)/g,
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