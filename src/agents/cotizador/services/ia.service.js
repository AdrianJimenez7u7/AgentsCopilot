export class IAService {
  static async buscarProductosRelevantes(solicitud, todosProductos) {
    const nombresProductos = todosProductos
      .map((p, idx) => `${idx}: ${p.nombre} - ${p.descripcion}`)
      .join('\n');
    
    const prompt = `Eres un asistente que ayuda a encontrar productos relevantes para una cotización.

Lista de productos disponibles:
${nombresProductos}

Solicitud del cliente: "${solicitud}"

Analiza la solicitud y devuelve SOLO un array JSON con los índices de los productos relevantes.
Ejemplo: [0, 5, 12]

Si no encuentras productos exactos, busca los más cercanos o relacionados.
Responde ÚNICAMENTE con el array JSON, sin texto adicional.`;

    // Build payload matching the Azure REST API example
    const payload = {
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 13107,
      temperature: 1,
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
    const contenido = (data.choices?.[0]?.message?.content ?? data.choices?.[0]?.content ?? '').trim();
    const indices = JSON.parse(contenido);
    
    return indices.map(idx => todosProductos[idx]).filter(p => p);
  }
}