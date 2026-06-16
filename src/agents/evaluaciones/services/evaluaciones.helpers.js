import { prisma } from '../../../shared/prisma/client.js';

export function rangoFromPuntos(p = 0) {
  if (p >= 0 && p <= 30) return "Explorador";
  if (p > 30 && p <= 60) return "Pionero";
  if (p > 60 && p <= 89) return "Adoptador";
  return "Integrador";
}

export function toInt(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

export const KNOWLEDGE_BASE = {
  ENTRY: {
    descripcion: "Familiaridad general con IA generativa y primeros pasos de uso continuo.",
    conocimientos: [
      "Cuándo y para qué usar un asistente de IA (casos cotidianos).",
      "Buenas prácticas básicas de seguridad y uso responsable.",
      "Estructura mínima de un prompt (tarea + contexto + formato).",
      "Rutina simple: 10–15 min diarios de práctica con tareas reales."
    ]
  },
  NIVEL_1: {
    descripcion: "Prompts efectivos, contenido profesional y productividad asistida.",
    conocimientos: [
      "Ciclo de mejora de prompts (probar, evaluar, refinar).",
      "Roles, ejemplos y restricciones en el prompt.",
      "IA como coautor/a: esbozos, edición, verificación y complementos.",
      "Productividad asistida: desglosar objetivos en tareas y prioridades.",
      "Resolución guiada de problemas: hipótesis, contraejemplos y verificación.",
      "Práctica: redactar un prompt completo para un email o aviso interno."
    ]
  },
  NIVEL_2: {
    descripcion: "Integración en procesos, personalización y análisis de datos.",
    conocimientos: [
      "Integrar IA con herramientas de trabajo (M365/Google, CRM, etc.).",
      "Comunicación personalizada: audiencia, tono, objetivo y formato.",
      "Análisis de datos con IA: tablas, tendencias e insights accionables.",
      "Aprendizaje continuo con IA: microhábitos y planes de mejora.",
      "Medición de impacto: estimar horas ahorradas y mejoras recurrentes.",
      "Práctica: prompt avanzado con contexto, audiencia y tipo de análisis."
    ]
  },
  NIVEL_3: {
    descripcion: "Automatizaciones, agentes y gestión de iniciativas con IA.",
    conocimientos: [
      "Automatizaciones con IA: flujos de extremo a extremo (de nota a tarea a reporte).",
      "Diseño/uso de asistentes (agentes) para procesos repetitivos.",
      "Investigación asistida: comparación de fuentes, extracción y resúmenes.",
      "Gestión del cambio: participar y co-liderar proyectos de adopción.",
      "Documentar y compartir buenas prácticas y casos de uso.",
      "Definir métricas de adopción y productividad por proceso/equipo.",
      "IA para coordinación de proyectos (agendas, seguimiento, comunicación)."
    ]
  },
  FINALES: {
    descripcion: "Adopción global, visión y principios de uso responsable.",
    conocimientos: [
      "Mapa de adopción por niveles (explorador → integrador).",
      "Visión 'IA-first': impacto transversal y priorización de casos de uso.",
      "Decálogo de uso responsable: ética, privacidad, revisión humana y mejora continua."
    ]
  }
};

function sanitizeLinks(recursos = []) {
  const normalized = (recursos || []).map(r => {
    if (r?.tipo === "link" && typeof r.link === "string" && /youtube\.com\/results\?/i.test(r.link)) {
      return {
        tipo: "query",
        titulo: r.titulo || "Búsqueda en YouTube",
        query: "automatizaciones IA " + (r.titulo || "").replace(/YouTube:?/i, "").trim()
      };
    }
    return r;
  });

  const ALLOWED = /^(https:\/\/)(learn\.microsoft\.com|developers\.google\.com|cloud\.google\.com|coursera\.org|edx\.org|(www\.)?youtube\.com)\b/i;

  return normalized.filter(r => {
    if (r?.tipo === "link") {
      if (typeof r.link !== "string" || !ALLOWED.test(r.link)) return false;
      if (/youtube\.com/i.test(r.link) && !/\/watch|\/playlist/i.test(r.link)) return false;
      return true;
    }
    if (r?.tipo === "query") return typeof r.query === "string" && r.query.trim().length > 0;
    return false;
  }).slice(0, 2);
}

export function validateAndNormalizeOpenAIResponse(aiRec) {
  const out = {
    analisisAI: { diagnostico: "" },
    cursosAI: { base: [], especificoArea: null }
  };

  if (aiRec && aiRec.analisisAI && typeof aiRec.analisisAI.diagnostico === "string") {
    out.analisisAI.diagnostico = aiRec.analisisAI.diagnostico.trim();
  }

  const base = Array.isArray(aiRec?.cursosAI?.base) ? aiRec.cursosAI.base : [];
  out.cursosAI.base = base.slice(0, 4).map(c => ({
    titulo: String(c?.titulo || "").trim(),
    nivel:  String(c?.nivel  || "").trim(),
    formato: String(c?.formato || "").trim(),
    objetivo: String(c?.objetivo || "").trim(),
    recursos: sanitizeLinks(c?.recursos)
  })).filter(c => c.titulo && c.nivel && c.formato && c.objetivo && c.recursos?.length);

  const ea = aiRec?.cursosAI?.especificoArea || null;
  if (ea && ea.titulo && ea.nivel && ea.formato && ea.objetivo) {
    out.cursosAI.especificoArea = {
      titulo: String(ea.titulo).trim(),
      nivel:  String(ea.nivel).trim(),
      formato: String(ea.formato).trim(),
      objetivo: String(ea.objetivo).trim(),
      recursos: sanitizeLinks(ea.recursos)
    };
  }

  const totalCursos = out.cursosAI.base.length + (out.cursosAI.especificoArea ? 1 : 0);
  if (totalCursos < 3) {
    out.cursosAI.base.push({
      titulo: "Activación de adopción con IA (reto 2 semanas)",
      nivel: "Básico",
      formato: "1–2h (setup + seguimiento)",
      objetivo: "Aumentar la tasa de respuesta +10 pts en 4 semanas mediante un reto de uso semanal y nominación de champions.",
      recursos: [{
        tipo: "query",
        titulo: "Buenas prácticas de activación de IA en equipos",
        query: "ai adoption playbook team activation weekly challenge"
      }]
    });
  }

  if (!out.analisisAI.diagnostico) out.analisisAI.diagnostico = "Diagnóstico basado en métricas no disponible por el momento.";
  if (out.cursosAI.base.length === 0 && !out.cursosAI.especificoArea) {
    out.cursosAI.base = [{
      titulo: "Fundamentos de IA aplicada y prompts esenciales",
      nivel: "Básico",
      formato: "Taller práctico (3h)",
      objetivo: "Aplicar prompts claros a tareas reales y medir un ahorro de tiempo (≥15 min/día).",
      recursos: [{ tipo: "link", titulo: "Prompt engineering (Azure OpenAI)", link: "https://learn.microsoft.com/azure/ai-services/openai/how-to/prompt-engineering" }]
    }];
  }

  return out;
}

export async function callAzureOpenAI(prompt, ejercicio) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_API_KEY;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2024-12-01-preview";

  const url = `${endpoint}?api-version=${apiVersion}`;

  const body = {
    messages: [
      {
        role: "system",
        content: "Eres un evaluador experto. Debes calificar el prompt del usuario en una escala del 1 al 8 considerando:1=Muy pobre, 8=Excelente. Criterios: Claridad (2pts), Originalidad (2pts), Relevancia (2pts), Potencial de respuesta (2pts). Responde solo con el número.",
      },
      {
        role: "user",
        content: `Ejercicio: ${ejercicio}\n\nPrompt del usuario:\n${prompt}`,
      },
    ],
    temperature: 0,
    max_tokens: 10,
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(`Azure OpenAI ${resp.status}: ${JSON.stringify(data)}`);

  const content = data?.choices?.[0]?.message?.content ?? "";
  const m = content.match(/^[ \t\r\n]*([1-8])[ \t\r\n]*$/);
  if (!m) throw new Error(`Respuesta no numérica válida: "${content}"`);
  return Number(m[1]);
}

export async function callAzureOpenAIRecomendacionesAreaV4(input) {
  const endpoint   = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey     = process.env.AZURE_API_KEY;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview';

  const url = `${endpoint}?api-version=${apiVersion}`;

  const payload = {
    area: input.area,
    firma: input.firma,
    fortalecerNiveles: input.fortalecerNiveles,
    conocimientosObjetivo: input.conocimientosObjetivo,
    rendimiento: input.rendimiento
  };

  const ALLOWED_LINK_DOMAINS = [
    "learn.microsoft.com", "developers.google.com", "cloud.google.com",
    "coursera.org", "edx.org", "youtube.com", "www.youtube.com"
  ];

  const systemPrompt = [
    "Eres un consultor de capacitación con tono profesional, respetuoso y constructivo de adopción de IA. Evita lenguaje negativo o juicios de capacidad; enfócate en oportunidades y próximos pasos. Genera un diagnóstico y un paquete de cursos no genéricos, anclados a métricas.",
    "Debes leer las métricas de rendimiento (tasa de respuesta, % por nivel, rangos) y usar ese contexto para diferenciar la salida por área.",
    "Obligatorio en diagnóstico: mencionar al menos un gap explícito (ej. N2=0% o N1<50%) y la tasa de respuesta.",
    "Si rendimiento.tasaRespuesta < 35 incluye un curso corto o bloque 'Activación' (1–2h) con un objetivo medible (p.ej., +10 pts en tasa de respuesta en 4 semanas).",
    "Cada 'objetivo' DEBE incluir una métrica numérica (minutos ahorrados, nº de plantillas publicadas, % adopción N1→N2, nº de flujos automatizados, etc.).",
    "Si alguno de los niveles NIVEL_2 o NIVEL_3 en rendimiento.niveles es 0, devuelve al menos 4 cursos en total e incluye 1 curso 'puente' (de notas→tareas→reporte o integración M365/CRM).",
    "Evita repetir títulos entre áreas; si tasaRespuesta<35 o N2/N3=0, incluye el nombre del área en al menos uno de los títulos base.",
    "Cursos: entrega entre 3 y 5 en total (mezcla de 'base' 2–4 y 1 'especificoArea').",
    "Cada curso: titulo, nivel (Básico/Intermedio/Avanzado), formato (con duración), objetivo (con resultado tangible) y recursos (1–2).",
    "Recursos deben ser de dominios confiables: " + ALLOWED_LINK_DOMAINS.join(", ") + ".",
    "Si no estás seguro del link exacto, usa tipo:'query' con un texto de búsqueda concreto.",
    "Si algún recurso apunta a un enlace de resultados de YouTube (youtube.com/results), devuélvelo como tipo:'query' en vez de link.",
    "Evita frases vagas como 'acompañamiento ligero' o 'hábitos simples' sin ejemplo.",
    "Adapta ejemplos al área (Adobe: briefs/assets; Operaciones: SOPs/reportes; Transformación Digital: flujos M365/CRM).",
    "Formato de salida (JSON estricto, sin texto extra):",
    "{",
    '  "analisisAI": { "diagnostico": "..." },',
    '  "cursosAI": {',
    '     "base": [',
    '        {"titulo":"...","nivel":"Básico|Intermedio|Avanzado","formato":"... (2–5h)","objetivo":"... (resultado tangible con métrica)","recursos":[{"tipo":"link","titulo":"...","link":"https://..."},{"tipo":"query","titulo":"...","query":"..."}]}',
    '     ],',
    '     "especificoArea": {"titulo":"...","nivel":"...","formato":"...","objetivo":"... (con métrica)","recursos":[...]}',
    '  }',
    "}"
  ].join(" ");

  const body = {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: `Contexto:\n${JSON.stringify(payload)}` },
      { role: "user",   content: `KNOWLEDGE_BASE (para alinear términos, no para copiar texto):\n${JSON.stringify(KNOWLEDGE_BASE)}` }
    ],
    temperature: 0.2,
    max_tokens: 1100,
    response_format: { type: "json_object" }
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await resp.json();
  if (!resp.ok) {
    console.error("Azure OpenAI error:", resp.status, data);
    throw new Error(`Azure OpenAI ${resp.status}: ${JSON.stringify(data)}`);
  }

  const text = data?.choices?.[0]?.message?.content?.trim() || "{}";
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export function mapSimpliaToLegacy(colab, fallbackId) {
  if (!colab) return null;
  return {
    idColaborador: colab.ID_Usuario_Externo ?? String(colab.id_Usuario ?? fallbackId ?? ''),
    names: colab.Nombre ?? null,
    lastNames: [colab.Apellido_Paterno, colab.Apellido_Materno].filter(Boolean).join(' ') || null,
    correo: colab.Correo ?? null,
    foto: colab.Foto ?? null,
    area: colab.Area?.Nombre ?? null,
    idArea: colab.Area?.id_Area ?? null,
    puesto: colab.Puesto?.Nombre ?? null,
    idPuesto: colab.Puesto?.id_Puesto ?? null,
    nivelPuesto: colab.Puesto?.Nivel ?? null,
  };
}
