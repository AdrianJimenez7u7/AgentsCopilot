import { prisma } from '../../../shared/prisma/client.js';

const TABLE_CONFIG = {
  examenes: {
    model: prisma.evaluacionesExamen,
    knownFields: ['nombre'],
  },
  preguntas: {
    model: prisma.evaluacionesPreguntas,
    knownFields: ['pregunta', 'respuesta', 'puntosMaximos', 'idExamen', 'nivel', 'tipo'],
  },
  incisos: {
    model: prisma.evaluacionesIncisos,
    knownFields: ['idPregunta', 'letra', 'texto', 'puntos', 'idExamen'],
  },
  respuestas: {
    model: prisma.evaluacionesRespuestas,
    knownFields: ['tipo', 'respuesta', 'puntos', 'idPregunta', 'nivel', 'idExamen', 'idColaborador', 'posicion'],
  },
  ranking: {
    model: prisma.evaluacionesRanking,
    knownFields: ['idColaborador', 'rango', 'puntos', 'examenesRealizados', 'fechaInicio', 'ultimaActualizacion'],
  },
  rankingPorExamen: {
    model: prisma.evaluacionesRankingPorExamen,
    knownFields: ['idColaborador', 'idExamen', 'rango', 'puntos', 'fechaInicio', 'ultimaActualizacion'],
  },
  resultados: {
    model: prisma.evaluacionesResultadosPorExamen,
    knownFields: ['calificacion', 'rango', 'preguntasContestadas', 'ejerciciosContestados', 'idColaborador', 'idExamen'],
  },
};

const INTEGER_FIELDS = new Set([
  'id', 'puntos', 'idPregunta', 'idExamen', 'puntosMaximos',
  'posicion', 'examenesRealizados', 'calificacion',
  'preguntasContestadas', 'ejerciciosContestados',
]);

const DATETIME_FIELDS = new Set([
  'fechaInicio', 'ultimaActualizacion',
]);

function coerceRow(row) {
  const coerced = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === '' || value === null || value === undefined) {
      coerced[key] = null;
    } else if (INTEGER_FIELDS.has(key)) {
      const n = parseInt(value, 10);
      coerced[key] = Number.isNaN(n) ? null : n;
    } else if (DATETIME_FIELDS.has(key)) {
      const d = new Date(value);
      coerced[key] = Number.isNaN(d.getTime()) ? null : d;
    } else {
      coerced[key] = value;
    }
  }
  return coerced;
}

export async function bulkImport(tableName, rows) {
  const config = TABLE_CONFIG[tableName];
  if (!config) {
    throw new Error(`Tabla desconocida: ${tableName}. Las opciones son: ${Object.keys(TABLE_CONFIG).join(', ')}`);
  }

  if (!Array.isArray(rows) || !rows.length) {
    return { inserted: 0, message: 'No hay datos para importar.' };
  }

  const created = [];

  for (const rawRow of rows) {
    const data = coerceRow(rawRow);
    // Eliminar campos que no existen en el modelo
    for (const key of Object.keys(data)) {
      if (!config.knownFields.includes(key)) {
        delete data[key];
      }
    }
    const record = await config.model.create({ data });
    created.push(record);
  }

  return {
    inserted: created.length,
    table: tableName,
  };
}
