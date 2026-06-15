import { prisma } from '../../../shared/prisma/client.js';
import { successResponse, errorResponse } from '../../../shared/utils/response.js';
import { rangoFromPuntos, toInt, mapSimpliaToLegacy, validateAndNormalizeOpenAIResponse, callAzureOpenAI, callAzureOpenAIRecomendacionesAreaV4, KNOWLEDGE_BASE } from '../services/evaluaciones.helpers.js';
import { bulkImport } from '../services/evaluaciones.import.service.js';


export const simpleURL = process.env.SIMPLIA_AGENTS_BACKEND;
export const simplaApiKey = process.env.SIMPLIA_AGENTS_BACKEND_API_KEY;

export async function getColaboradoresByIdColaborador(idColaboradorArr) {
  try {
    const ids = [...new Set((idColaboradorArr || []).filter(Boolean))];
    if (!ids.length) return new Map();

    // Para 1 solo ID usar endpoint directo (más rápido)
    if (ids.length === 1) {
      const resp = await fetch(`${simpleURL}auth/colaboradores`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': `${simplaApiKey}`,
          'x-user-email': 'transformacion.digital@compucad.com.mx'
        },
        body: JSON.stringify({ idExterno: ids })
      });
      const json = await resp.json();
      const arr = Array.isArray(json) ? json : (json?.colaboradores ?? []);
      const map = new Map();
      if (arr.length) {
        map.set(ids[0], mapSimpliaToLegacy(arr[0], ids[0]));
      }
      return map;
    }

    // Para varios IDs usar /auth/users (trae ID_Usuario_Externo)
    const resp = await fetch(`${simpleURL}auth/users`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': `${simplaApiKey}`,
        'x-user-email': 'transformacion.digital@compucad.com.mx'
      }
    });
    const json = await resp.json();
    const users = Array.isArray(json) ? json : (json?.users ?? json?.colaboradores ?? []);
    const map = new Map();
    for (const user of users) {
      const key = user.ID_Usuario_Externo;
      if (key && ids.includes(key)) {
        map.set(key, mapSimpliaToLegacy(user, key));
      }
    }
    return map;
  } catch (error) {
    console.error('Error al obtener colaboradores:', error);
    throw new Error('Error interno del servidor al obtener colaboradores');
  }
}

export async function getAllColaboradores() {
  try {
    const colaboraderes = await fetch(`${simpleURL}auth/users`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': `${simplaApiKey}`,
        'x-user-email': 'transformacion.digital@compucad.com.mx'
      }
    });
    const colaboradoresData = await colaboraderes.json();
    return colaboradoresData;
  } catch (error) {
    console.error('Error al obtener colaboradores:', error);
    throw new Error('Error interno del servidor al obtener colaboradores');
  }
}

// ============================================================================
// RESPONSES
// ============================================================================
export class EvaluacionesController {

  static async getColaborador(req, res) {
    try {
      const idColaborador = String(req.query.idColaborador ?? '').trim();
      if (!idColaborador) return errorResponse(res, 'idColaborador es obligatorio', 400);
        const simpliaMap = await getColaboradoresByIdColaborador([idColaborador]);
        const colaboradorData = simpliaMap.get(idColaborador) ?? null;
      if (!colaboradorData) {
        return successResponse(res, null, `No se encontró información para el colaborador con id ${idColaborador}.`);
      }
      return successResponse(res, colaboradorData, 'Colaborador obtenido exitosamente');
    } catch (error) {
      console.error('Error al obtener colaborador:', error);
      return errorResponse(res, 'Error interno del servidor al obtener colaborador');
    }
  }

  /**
   * Obtiene la información de un colaborador por su correo electrónico 
   * estructura de simpli: {    {
      id_Usuario: '',
      Nombre: '',
      Apellido_Paterno: '',
      Apellido_Materno: '',
      Correo: '@compucad.com.mx',
      Foto: '',
      Area: [Object],
      Puesto: [Object],
      ID_Usuario_Externo: 'MAIE160613'
    }}
   * @param {*} req 
   * @param {*} res 
   * @returns 
   */
  static async getColaboradorByCorreo(req, res) {
    try {
      const correo = String(req.params.correo ?? '').trim();
      if (!correo) return errorResponse(res, 'Correo es obligatorio', 400);
      const colaboradoresData = await getAllColaboradores();
      const colaborador = colaboradoresData?.users?.find(c => String(c.Correo ?? '').trim().toLowerCase() === correo.toLowerCase());
      if (!colaborador) {
        return successResponse(res, null, `No se encontró información para el colaborador con correo ${correo}.`);
      }
      return successResponse(res, colaborador, 'Colaborador obtenido exitosamente');
    } catch (error) {
      console.error('Error al obtener colaborador por correo:', error);
      return errorResponse(res, 'Error interno del servidor al obtener colaborador');
    }
  }

  static async getAllRespuestas(req, res) {
    try {
      const respuestas = await prisma.evaluacionesRespuestas.findMany();
      if (!respuestas.length) {
        return successResponse(res, [], 'Aún no hay respuestas registradas.');
      }
      return successResponse(res, respuestas, `Respuestas obtenidas exitosamente (${respuestas.length}).`);
    } catch (error) {
      console.error('Error al obtener respuestas:', error);
      return errorResponse(res, 'Error interno del servidor al obtener respuestas');
    }
  }

  static async getRespuestaById(req, res) {
    try {
      const id = toInt(req.params.id);
      if (id == null) return errorResponse(res, 'El parámetro :id debe ser un número entero válido', 400);
      const respuesta = await prisma.evaluacionesRespuestas.findUnique({ where: { id } });
      if (!respuesta) return successResponse(res, null, `No existe una respuesta con el id ${id}.`);
      return successResponse(res, respuesta, 'Respuesta obtenida exitosamente');
    } catch (error) {
      console.error('Error al obtener respuesta por ID:', error);
      return errorResponse(res, 'Error interno del servidor al obtener respuesta');
    }
  }

  static async updateRespuesta(req, res) {
    try {
      const id = toInt(req.params.id);
      if (id == null) return errorResponse(res, 'id debe ser numérico', 400);
      const updateData = req.body;
      const existe = await prisma.evaluacionesRespuestas.findUnique({ where: { id } });
      if (!existe) return errorResponse(res, 'Respuesta no encontrada', 404);
      const data = {};
      if (updateData.tipo !== undefined) data.tipo = String(updateData.tipo).trim();
      if (updateData.respuesta !== undefined) data.respuesta = String(updateData.respuesta).trim();
      if (updateData.puntos !== undefined) data.puntos = toInt(updateData.puntos);
      if (updateData.idPregunta !== undefined) data.idPregunta = toInt(updateData.idPregunta);
      if (updateData.nivel !== undefined) data.nivel = String(updateData.nivel).trim();
      if (updateData.idExamen !== undefined) data.idExamen = toInt(updateData.idExamen);
      if (updateData.idColaborador !== undefined) data.idColaborador = String(updateData.idColaborador).trim();
      if (updateData.posicion !== undefined) data.posicion = toInt(updateData.posicion);
      const updated = await prisma.evaluacionesRespuestas.update({ where: { id }, data });
      return successResponse(res, updated, 'Respuesta actualizada exitosamente');
    } catch (error) {
      console.error('Error al actualizar respuesta:', error);
      return errorResponse(res, 'Error interno del servidor al actualizar respuesta');
    }
  }

  static async deleteRespuesta(req, res) {
    try {
      const id = toInt(req.params.id);
      if (id == null) return errorResponse(res, 'id debe ser numérico', 400);
      const existe = await prisma.evaluacionesRespuestas.findUnique({ where: { id } });
      if (!existe) return errorResponse(res, 'Respuesta no encontrada', 404);
      await prisma.evaluacionesRespuestas.delete({ where: { id } });
      return successResponse(res, null, 'Respuesta eliminada exitosamente');
    } catch (error) {
      if (error?.code === 'P2003') {
        return errorResponse(res, 'No se puede eliminar la respuesta: existen registros relacionados.', 409);
      }
      console.error('Error al eliminar respuesta:', error);
      return errorResponse(res, 'Error interno del servidor al eliminar respuesta');
    }
  }

  static async getRespuestasByExamen(req, res) {
    try {
      const examenId = toInt(req.params.idExamen);
      if (examenId == null) return errorResponse(res, 'idExamen debe ser numérico', 400);
      const where = { idExamen: examenId };
      if (req.query.idColaborador) {
        const colab = String(req.query.idColaborador).trim();
        if (colab) where.idColaborador = colab;
      }
      const respuestas = await prisma.evaluacionesRespuestas.findMany({ where });
      if (!respuestas.length) {
        return successResponse(res, [], `Aún no hay respuestas registradas para el examen ${examenId}.`);
      }
      return successResponse(res, respuestas, `Respuestas filtradas por idExamen (${examenId}).`);
    } catch (error) {
      console.error('Error al obtener respuestas por idExamen:', error);
      return errorResponse(res, 'Error interno del servidor al obtener respuestas por idExamen');
    }
  }

  static async getRespuestasByExamenColaborador(req, res) {
    try {
      const examenId = toInt(req.params.idExamen);
      if (examenId == null) return errorResponse(res, 'idExamen debe ser numérico', 400);
      const where = { idExamen: examenId };
      let colab = req.params.idColaborador ?? req.query.idColaborador;
      if (colab !== undefined) {
        colab = String(colab).trim();
        if (!colab) return errorResponse(res, 'idColaborador no puede estar vacío', 400);
        where.idColaborador = colab;
      }
      const respuestas = await prisma.evaluacionesRespuestas.findMany({ where });
      if (!respuestas.length) {
        const detalle = where.idColaborador
          ? `para el examen ${examenId} y el colaborador ${where.idColaborador}`
          : `para el examen ${examenId}`;
        return successResponse(res, [], `Aún no hay respuestas registradas ${detalle}.`);
      }
      const detalle = where.idColaborador
        ? `por idExamen (${examenId}) e idColaborador (${where.idColaborador}).`
        : `por idExamen (${examenId}).`;
      return successResponse(res, respuestas, `Respuestas filtradas ${detalle}`);
    } catch (error) {
      console.error('Error al obtener respuestas por idExamen/idColaborador:', error);
      return errorResponse(res, 'Error interno del servidor al obtener respuestas por idExamen/idColaborador');
    }
  }

  static async getRespuestasByColaborador(req, res) {
    try {
      const colab = String(req.params.idColaborador ?? '').trim();
      if (!colab) return errorResponse(res, 'idColaborador es obligatorio', 400);
      const where = { idColaborador: colab };
      const respuestas = await prisma.evaluacionesRespuestas.findMany({ where });
      if (!respuestas.length) {
        return successResponse(res, [], `Aún no hay respuestas registradas para el colaborador ${colab}.`);
      }
      return successResponse(res, respuestas, `Respuestas filtradas por idColaborador (${colab}).`);
    } catch (error) {
      console.error('Error al obtener respuestas por idColaborador:', error);
      return errorResponse(res, 'Error interno del servidor al obtener respuestas por idColaborador');
    }
  }

  static async createRespuesta(req, res) {
    const { tipo, respuesta, puntos, idPregunta, nivel, idExamen, idColaborador, posicion } = req.body;
    try {
      if (respuesta == null || idPregunta == null || idExamen == null) {
        return errorResponse(res, 'Los campos respuesta, idPregunta e idExamen son obligatorios', 400);
      }
      const colab = idColaborador != null ? String(idColaborador).trim() : null;
      const exam = toInt(idExamen);
      const preg = toInt(idPregunta);

      const out = await prisma.$transaction(async (tx) => {
        const createdRespuesta = await tx.evaluacionesRespuestas.create({
          data: {
            tipo: tipo ? String(tipo).trim() : null,
            respuesta: String(respuesta).trim(),
            puntos: toInt(puntos),
            idPregunta: preg,
            nivel: nivel ? String(nivel).trim() : null,
            idExamen: exam,
            idColaborador: colab,
            posicion: toInt(posicion),
          }
        });

        const filtroColab = colab == null ? { idColaborador: null } : { idColaborador: colab };
        const agg = await tx.evaluacionesRespuestas.aggregate({
          _sum: { puntos: true },
          where: { ...filtroColab, idExamen: exam }
        });
        const pregIds = await tx.evaluacionesRespuestas.findMany({
          where: { ...filtroColab, idExamen: exam },
          select: { idPregunta: true, tipo: true, puntos: true },
          distinct: ['idPregunta']
        });
        const totalPuntos = Number(agg._sum.puntos ?? 0);
        const preguntasContestadas = pregIds.length;
        const ejerciciosContestados = pregIds.filter(p => (p.tipo || '').toUpperCase() === 'EJERCICIO').length;
        const rango = rangoFromPuntos(totalPuntos);

        let resultado;
        const existente = await tx.evaluacionesResultadosPorExamen.findFirst({
          where: { idColaborador: colab, idExamen: exam }
        });
        if (!existente) {
          resultado = await tx.evaluacionesResultadosPorExamen.create({
            data: {
              calificacion: totalPuntos, rango, preguntasContestadas,
              ejerciciosContestados, idColaborador: colab, idExamen: exam
            }
          });
        } else {
          resultado = await tx.evaluacionesResultadosPorExamen.update({
            where: { id: existente.id },
            data: { calificacion: totalPuntos, rango, preguntasContestadas, ejerciciosContestados }
          });
        }

        if (colab != null && colab !== '') {
          const rankAgg = await tx.evaluacionesResultadosPorExamen.aggregate({
            _sum: { calificacion: true },
            _count: true,
            where: { idColaborador: colab }
          });
          const puntosTotales = Number(rankAgg._sum.calificacion ?? 0);
          const examenesRealizados = rankAgg._count;
          const rangoFinal = rangoFromPuntos(puntosTotales);
          const now = new Date();

          let ranking = await tx.evaluacionesRanking.findFirst({
            where: { idColaborador: colab }
          });
          if (!ranking) {
            await tx.evaluacionesRanking.create({
              data: {
                idColaborador: colab, rango: rangoFinal, puntos: puntosTotales,
                examenesRealizados, fechaInicio: now, ultimaActualizacion: now
              }
            });
          } else {
            await tx.evaluacionesRanking.update({
              where: { id: ranking.id },
              data: { rango: rangoFinal, puntos: puntosTotales, examenesRealizados, ultimaActualizacion: now }
            });
          }

          const puntosExamen = totalPuntos;
          const rangoExamen = rangoFromPuntos(puntosExamen);
          let rx = await tx.evaluacionesRankingPorExamen.findFirst({
            where: { idColaborador: colab, idExamen: exam }
          });
          if (!rx) {
            await tx.evaluacionesRankingPorExamen.create({
              data: {
                idColaborador: colab, idExamen: exam, rango: rangoExamen,
                puntos: puntosExamen, fechaInicio: now, ultimaActualizacion: now
              }
            });
          } else {
            await tx.evaluacionesRankingPorExamen.update({
              where: { id: rx.id },
              data: { rango: rangoExamen, puntos: puntosExamen, ultimaActualizacion: now }
            });
          }
        }
        return { createdRespuesta, resultado };
      });

      return res.status(201).json({
        success: true, data: out, message: 'Respuesta creada, resultado y ranking actualizados'
      });
    } catch (error) {
      console.error('Error en createRespuesta:', { message: error?.message, name: error?.name });
      return errorResponse(res, 'Error interno del servidor al crear respuesta/actualizar resultado y ranking');
    }
  }

  static async bulkCreateRespuestas(req, res) {
    try {
      const payload = Array.isArray(req.body) ? req.body : req.body?.respuestas;
      if (!Array.isArray(payload) || payload.length === 0) {
        return errorResponse(res, 'Debes enviar un arreglo de respuestas en el cuerpo de la petición', 400);
      }
      const errores = [];
      const normalizados = payload.map((r, idx) => {
        const item = {
          tipo: r?.tipo != null ? String(r.tipo).trim() : null,
          respuesta: r?.respuesta != null ? String(r.respuesta).trim() : null,
          puntos: toInt(r?.puntos),
          idPregunta: toInt(r?.idPregunta),
          nivel: r?.nivel != null ? String(r.nivel).trim() : null,
          idExamen: toInt(r?.idExamen),
          idColaborador: r?.idColaborador != null ? String(r.idColaborador).trim() : null,
          posicion: toInt(r?.posicion),
        };
        if (item.respuesta == null || item.idPregunta == null || item.idExamen == null) {
          errores.push(`Índice ${idx}: 'respuesta', 'idPregunta' e 'idExamen' son obligatorios.`);
        }
        return item;
      });
      if (errores.length) {
        return res.status(400).json({ success: false, error: true, message: 'Error de validación en el lote de respuestas', details: errores });
      }

      const pairs = new Map();
      const colaboradores = new Set();
      for (const n of normalizados) {
        const key = `${n.idColaborador ?? 'NULL'}|${n.idExamen}`;
        if (!pairs.has(key)) pairs.set(key, { colab: n.idColaborador ?? null, exam: n.idExamen });
        if (n.idColaborador) colaboradores.add(n.idColaborador);
      }

      const resultOut = await prisma.$transaction(async (tx) => {
        const toInsert = normalizados.map(n => ({
          tipo: n.tipo, respuesta: n.respuesta, puntos: n.puntos,
          idPregunta: n.idPregunta, nivel: n.nivel, idExamen: n.idExamen,
          idColaborador: n.idColaborador, posicion: n.posicion,
        }));
        await tx.evaluacionesRespuestas.createMany({ data: toInsert });

        let resultadosAfectados = 0;
        let rankingsPorExamenAfectados = 0;
        const now = new Date();

        for (const { colab, exam } of pairs.values()) {
          const filtroColab = colab == null || colab === '' ? { idColaborador: null } : { idColaborador: colab };
          const agg = await tx.evaluacionesRespuestas.aggregate({
            _sum: { puntos: true },
            where: { ...filtroColab, idExamen: exam }
          });
          const pregs = await tx.evaluacionesRespuestas.findMany({
            where: { ...filtroColab, idExamen: exam },
            select: { idPregunta: true, tipo: true },
            distinct: ['idPregunta']
          });
          const totalPuntos = Number(agg._sum.puntos ?? 0);
          const preguntasContestadas = preg.length;
          const ejerciciosContestados = preg.filter(p => (p.tipo || '').toUpperCase() === 'EJERCICIO').length;
          const rango = rangoFromPuntos(totalPuntos);

          const existente = await tx.evaluacionesResultadosPorExamen.findFirst({
            where: { idColaborador: colab, idExamen: exam }
          });
          if (!existente) {
            if (preguntasContestadas > 0) {
              await tx.evaluacionesResultadosPorExamen.create({
                data: { calificacion: totalPuntos, rango, preguntasContestadas, ejerciciosContestados, idColaborador: colab, idExamen: exam }
              });
              resultadosAfectados++;
            }
          } else {
            await tx.evaluacionesResultadosPorExamen.update({
              where: { id: existente.id },
              data: { calificacion: totalPuntos, rango, preguntasContestadas, ejerciciosContestados }
            });
            resultadosAfectados++;
          }

          if (colab != null && colab !== '') {
            let rkExam = await tx.evaluacionesRankingPorExamen.findFirst({
              where: { idColaborador: colab, idExamen: exam }
            });
            if (!rkExam) {
              if (preguntasContestadas > 0) {
                await tx.evaluacionesRankingPorExamen.create({
                  data: { idColaborador: colab, idExamen: exam, rango, puntos: totalPuntos, fechaInicio: now, ultimaActualizacion: now }
                });
                rankingsPorExamenAfectados++;
              }
            } else {
              await tx.evaluacionesRankingPorExamen.update({
                where: { id: rkExam.id },
                data: { rango, puntos: totalPuntos, ultimaActualizacion: now }
              });
              rankingsPorExamenAfectados++;
            }
          }
        }

        let rankingsAfectados = 0;
        for (const colab of colaboradores) {
          const rankAgg = await tx.evaluacionesResultadosPorExamen.aggregate({
            _sum: { calificacion: true },
            _count: true,
            where: { idColaborador: colab }
          });
          const puntosTotales = Number(rankAgg._sum.calificacion ?? 0);
          const examenesRealizados = rankAgg._count;
          const rangoFinal = rangoFromPuntos(puntosTotales);

          let ranking = await tx.evaluacionesRanking.findFirst({
            where: { idColaborador: colab }
          });
          if (!ranking) {
            await tx.evaluacionesRanking.create({
              data: { idColaborador: colab, rango: rangoFinal, puntos: puntosTotales, examenesRealizados, fechaInicio: now, ultimaActualizacion: now }
            });
            rankingsAfectados++;
          } else {
            await tx.evaluacionesRanking.update({
              where: { id: ranking.id },
              data: { rango: rangoFinal, puntos: puntosTotales, examenesRealizados, ultimaActualizacion: now }
            });
            rankingsAfectados++;
          }
        }

        return { inserted: toInsert.length, resultadosAfectados, rankingsPorExamenAfectados, rankingsAfectados };
      });

      return res.status(201).json({
        success: true, data: resultOut,
        message: 'Respuestas creadas en lote. Resultados, ranking por examen y ranking global actualizados.'
      });
    } catch (error) {
      console.error('Error en bulkCreateRespuestas:', { message: error?.message, name: error?.name });
      return errorResponse(res, 'Error interno del servidor al crear respuestas en lote');
    }
  }

  static async deleteAllRespuestas(req, res) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const pairsRows = await tx.evaluacionesRespuestas.findMany({
          select: { idColaborador: true, idExamen: true },
          distinct: ['idColaborador', 'idExamen']
        });
        const pairs = pairsRows.map(r => ({ colab: r.idColaborador ?? null, exam: Number(r.idExamen) }));
        const colaboradores = new Set(pairs.map(p => p.colab).filter(c => c != null && c !== ''));
        const deleted = (await tx.evaluacionesRespuestas.deleteMany()).count;
        const now = new Date();

        let resultadosActualizados = 0;
        for (const { colab, exam } of pairs) {
          const filtroColab = colab == null || colab === '' ? { idColaborador: null } : { idColaborador: colab };
          const agg = await tx.evaluacionesRespuestas.aggregate({
            _sum: { puntos: true },
            where: { ...filtroColab, idExamen: exam }
          });
          const pregIds = await tx.evaluacionesRespuestas.findMany({
            where: { ...filtroColab, idExamen: exam },
            select: { idPregunta: true, tipo: true },
            distinct: ['idPregunta']
          });
          const totalPuntos = Number(agg._sum.puntos ?? 0);
          const preguntasContestadas = pregIds.length;
          const ejerciciosContestados = pregIds.filter(p => (p.tipo || '').toUpperCase() === 'EJERCICIO').length;
          const rango = rangoFromPuntos(totalPuntos);

          const existente = await tx.evaluacionesResultadosPorExamen.findFirst({
            where: { idColaborador: colab, idExamen: exam }
          });
          if (preguntasContestadas > 0) {
            if (!existente) {
              await tx.evaluacionesResultadosPorExamen.create({
                data: { calificacion: totalPuntos, rango, preguntasContestadas, ejerciciosContestados, idColaborador: colab, idExamen: exam }
              });
            } else {
              await tx.evaluacionesResultadosPorExamen.update({
                where: { id: existente.id },
                data: { calificacion: totalPuntos, rango, preguntasContestadas, ejerciciosContestados }
              });
            }
            resultadosActualizados++;
          } else {
            if (existente) {
              await tx.evaluacionesResultadosPorExamen.delete({ where: { id: existente.id } });
              resultadosActualizados++;
            }
          }
        }

        let rankingsActualizados = 0;
        for (const colab of colaboradores) {
          const rankAgg = await tx.evaluacionesResultadosPorExamen.aggregate({
            _sum: { calificacion: true },
            _count: true,
            where: { idColaborador: colab }
          });
          const puntosTotales = Number(rankAgg._sum.calificacion ?? 0);
          const examenesRealizados = rankAgg._count;
          const rangoFinal = rangoFromPuntos(puntosTotales);

          let rk = await tx.evaluacionesRanking.findFirst({
            where: { idColaborador: colab }
          });
          if (!rk) {
            if (examenesRealizados > 0) {
              await tx.evaluacionesRanking.create({
                data: { idColaborador: colab, rango: rangoFinal, puntos: puntosTotales, examenesRealizados, fechaInicio: now, ultimaActualizacion: now }
              });
              rankingsActualizados++;
            }
          } else {
            await tx.evaluacionesRanking.update({
              where: { id: rk.id },
              data: { rango: rangoFinal, puntos: puntosTotales, examenesRealizados, ultimaActualizacion: now }
            });
            rankingsActualizados++;
          }
        }

        return { deleted, resultadosActualizados, rankingsActualizados };
      });
      return successResponse(res, result, `Se eliminaron ${result.deleted} respuestas. Resultados (${result.resultadosActualizados}) y ranking (${result.rankingsActualizados}) recalculados.`);
    } catch (error) {
      if (error?.code === 'P2003') {
        return errorResponse(res, 'No se pueden eliminar las respuestas: existen registros relacionados.', 409);
      }
      console.error('Error al borrar todas las respuestas:', error);
      return errorResponse(res, 'Error interno del servidor al borrar todas las respuestas');
    }
  }

  static async deleteRespuestasByExamen(req, res) {
    try {
      const examenId = toInt(req.params.idExamen);
      if (examenId == null) return errorResponse(res, 'idExamen debe ser numérico', 400);

      const out = await prisma.$transaction(async (tx) => {
        const pairsRows = await tx.evaluacionesRespuestas.findMany({
          where: { idExamen: examenId },
          select: { idColaborador: true },
          distinct: ['idColaborador']
        });
        const pairs = (pairsRows || []).map(r => ({ colab: r.idColaborador ?? null, exam: examenId }));
        const colaboradores = new Set(pairs.map(p => p.colab).filter(c => c != null && c !== ''));
        const deleted = (await tx.evaluacionesRespuestas.deleteMany({ where: { idExamen: examenId } })).count;
        const now = new Date();

        let resultadosActualizados = 0, rankingsExamenActualizados = 0, rankingsExamenEliminados = 0;
        for (const { colab, exam } of pairs) {
          const filtroColab = colab == null || colab === '' ? { idColaborador: null } : { idColaborador: colab };
          const agg = await tx.evaluacionesRespuestas.aggregate({
            _sum: { puntos: true },
            where: { ...filtroColab, idExamen: exam }
          });
          const pregIds = await tx.evaluacionesRespuestas.findMany({
            where: { ...filtroColab, idExamen: exam },
            select: { idPregunta: true, tipo: true },
            distinct: ['idPregunta']
          });
          const totalPuntos = Number(agg._sum.puntos ?? 0);
          const preguntasContestadas = pregIds.length;
          const ejerciciosContestados = pregIds.filter(p => (p.tipo || '').toUpperCase() === 'EJERCICIO').length;
          const rango = rangoFromPuntos(totalPuntos);

          const existente = await tx.evaluacionesResultadosPorExamen.findFirst({
            where: { idColaborador: colab, idExamen: exam }
          });
          if (preguntasContestadas > 0) {
            if (!existente) {
              await tx.evaluacionesResultadosPorExamen.create({
                data: { calificacion: totalPuntos, rango, preguntasContestadas, ejerciciosContestados, idColaborador: colab, idExamen: exam }
              });
            } else {
              await tx.evaluacionesResultadosPorExamen.update({
                where: { id: existente.id },
                data: { calificacion: totalPuntos, rango, preguntasContestadas, ejerciciosContestados }
              });
            }
            resultadosActualizados++;
          } else {
            if (existente) { await tx.evaluacionesResultadosPorExamen.delete({ where: { id: existente.id } }); resultadosActualizados++; }
          }

          if (colab != null && colab !== '') {
            const rkEx = await tx.evaluacionesRankingPorExamen.findFirst({
              where: { idColaborador: colab, idExamen: exam }
            });
            if (preguntasContestadas > 0) {
              if (!rkEx) {
                await tx.evaluacionesRankingPorExamen.create({
                  data: { idColaborador: colab, idExamen: exam, rango, puntos: totalPuntos, fechaInicio: now, ultimaActualizacion: now }
                });
              } else {
                await tx.evaluacionesRankingPorExamen.update({
                  where: { id: rkEx.id },
                  data: { rango, puntos: totalPuntos, ultimaActualizacion: now }
                });
              }
              rankingsExamenActualizados++;
            } else {
              if (rkEx) { await tx.evaluacionesRankingPorExamen.delete({ where: { id: rkEx.id } }); rankingsExamenEliminados++; }
            }
          }
        }

        let rankingsActualizados = 0;
        for (const colab of colaboradores) {
          const rankAgg = await tx.evaluacionesResultadosPorExamen.aggregate({
            _sum: { calificacion: true }, _count: true, where: { idColaborador: colab }
          });
          const puntosTotales = Number(rankAgg._sum.calificacion ?? 0);
          const examenesRealizados = rankAgg._count;
          const rangoFinal = rangoFromPuntos(puntosTotales);

          let rk = await tx.evaluacionesRanking.findFirst({ where: { idColaborador: colab } });
          if (!rk) {
            if (examenesRealizados > 0) {
              await tx.evaluacionesRanking.create({
                data: { idColaborador: colab, rango: rangoFinal, puntos: puntosTotales, examenesRealizados, fechaInicio: now, ultimaActualizacion: now }
              });
              rankingsActualizados++;
            }
          } else {
            await tx.evaluacionesRanking.update({
              where: { id: rk.id },
              data: { rango: rangoFinal, puntos: puntosTotales, examenesRealizados, ultimaActualizacion: now }
            });
            rankingsActualizados++;
          }
        }
        return { deleted, resultadosActualizados, rankingsExamenActualizados, rankingsExamenEliminados, rankingsActualizados };
      });
      return successResponse(res, out, `Se eliminaron ${out.deleted} respuestas del examen ${req.params.idExamen}. Resultados (${out.resultadosActualizados}), ranking por examen (+${out.rankingsExamenActualizados}/-${out.rankingsExamenEliminados}) y ranking global (${out.rankingsActualizados}) recalculados.`);
    } catch (error) {
      if (error?.code === 'P2003') {
        return errorResponse(res, 'No se pueden eliminar las respuestas: existen registros relacionados.', 409);
      }
      console.error('Error al borrar respuestas por examen:', error);
      return errorResponse(res, 'Error interno del servidor al borrar respuestas por examen');
    }
  }

  static async deleteRespuestasByExamenYColaborador(req, res) {
    try {
      const examenId = toInt(req.params.idExamen);
      if (examenId == null) return errorResponse(res, 'idExamen debe ser numérico', 400);
      const colab = String(req.params.idColaborador ?? '').trim();
      if (!colab) return errorResponse(res, 'idColaborador es obligatorio', 400);

      const out = await prisma.$transaction(async (tx) => {
        const deleted = (await tx.evaluacionesRespuestas.deleteMany({
          where: { idExamen: examenId, idColaborador: colab }
        })).count;
        const now = new Date();

        const agg = await tx.evaluacionesRespuestas.aggregate({
          _sum: { puntos: true },
          where: { idColaborador: colab, idExamen: examenId }
        });
        const pregIds = await tx.evaluacionesRespuestas.findMany({
          where: { idColaborador: colab, idExamen: examenId },
          select: { idPregunta: true, tipo: true },
          distinct: ['idPregunta']
        });
        const totalPuntos = Number(agg._sum.puntos ?? 0);
        const preguntasContestadas = pregIds.length;
        const ejerciciosContestados = pregIds.filter(p => (p.tipo || '').toUpperCase() === 'EJERCICIO').length;
        const rango = rangoFromPuntos(totalPuntos);

        let resultadosActualizados = 0;
        const existente = await tx.evaluacionesResultadosPorExamen.findFirst({
          where: { idColaborador: colab, idExamen: examenId }
        });
        if (preguntasContestadas > 0) {
          if (!existente) {
            await tx.evaluacionesResultadosPorExamen.create({
              data: { calificacion: totalPuntos, rango, preguntasContestadas, ejerciciosContestados, idColaborador: colab, idExamen: examenId }
            });
          } else {
            await tx.evaluacionesResultadosPorExamen.update({
              where: { id: existente.id },
              data: { calificacion: totalPuntos, rango, preguntasContestadas, ejerciciosContestados }
            });
          }
          resultadosActualizados++;
        } else {
          if (existente) { await tx.evaluacionesResultadosPorExamen.delete({ where: { id: existente.id } }); resultadosActualizados++; }
        }

        let rankingsExamenActualizados = 0, rankingsExamenEliminados = 0;
        const rkEx = await tx.evaluacionesRankingPorExamen.findFirst({
          where: { idColaborador: colab, idExamen: examenId }
        });
        if (preguntasContestadas > 0) {
          if (!rkEx) {
            await tx.evaluacionesRankingPorExamen.create({
              data: { idColaborador: colab, idExamen: examenId, rango, puntos: totalPuntos, fechaInicio: now, ultimaActualizacion: now }
            });
          } else {
            await tx.evaluacionesRankingPorExamen.update({
              where: { id: rkEx.id },
              data: { rango, puntos: totalPuntos, ultimaActualizacion: now }
            });
          }
          rankingsExamenActualizados++;
        } else {
          if (rkEx) { await tx.evaluacionesRankingPorExamen.delete({ where: { id: rkEx.id } }); rankingsExamenEliminados++; }
        }

        const rankAgg = await tx.evaluacionesResultadosPorExamen.aggregate({
          _sum: { calificacion: true }, _count: true, where: { idColaborador: colab }
        });
        const puntosTotales = Number(rankAgg._sum.calificacion ?? 0);
        const examenesRealizados = rankAgg._count;
        const rangoFinal = rangoFromPuntos(puntosTotales);

        let rk = await tx.evaluacionesRanking.findFirst({ where: { idColaborador: colab } });
        if (!rk) {
          if (examenesRealizados > 0) {
            await tx.evaluacionesRanking.create({
              data: { idColaborador: colab, rango: rangoFinal, puntos: puntosTotales, examenesRealizados, fechaInicio: now, ultimaActualizacion: now }
            });
          }
        } else {
          await tx.evaluacionesRanking.update({
            where: { id: rk.id },
            data: { rango: rangoFinal, puntos: puntosTotales, examenesRealizados, ultimaActualizacion: now }
          });
        }

        return { deleted, resultadosActualizados, rankingsExamenActualizados, rankingsExamenEliminados, rankingsGlobalActualizados: 1 };
      });

      return successResponse(res, out, `Se eliminaron ${out.deleted} respuestas del examen ${examenId} del colaborador ${colab}. Resultados (${out.resultadosActualizados}), ranking por examen (+${out.rankingsExamenActualizados}/-${out.rankingsExamenEliminados}) y ranking global (${out.rankingsGlobalActualizados}) recalculados.`);
    } catch (error) {
      if (error?.code === 'P2003') return errorResponse(res, 'No se pueden eliminar las respuestas: existen registros relacionados.', 409);
      console.error('Error al borrar respuestas por examen y colaborador:', error);
      return errorResponse(res, 'Error interno del servidor al borrar respuestas por examen y colaborador');
    }
  }

  // ============================================================================
  // EXAMENES
  // ============================================================================

  static async getAllExamenes(req, res) {
    try {
      const examenes = await prisma.evaluacionesExamen.findMany();
      if (!examenes.length) return successResponse(res, [], 'Aún no hay exámenes registrados.');
      return successResponse(res, examenes, `Exámenes obtenidos exitosamente (${examenes.length}).`);
    } catch (error) {
      console.error('Error al obtener exámenes:', error);
      return errorResponse(res, 'Error interno del servidor al obtener exámenes');
    }
  }

  static async getExamenById(req, res) {
    try {
      const id = toInt(req.params.id);
      if (id == null) return errorResponse(res, 'id debe ser numérico', 400);
      const examen = await prisma.evaluacionesExamen.findUnique({ where: { id } });
      if (!examen) return successResponse(res, null, 'Examen no encontrado');
      return successResponse(res, examen, 'Examen obtenido exitosamente');
    } catch (error) {
      console.error('Error al obtener examen por ID:', error);
      return errorResponse(res, 'Error interno del servidor al obtener examen');
    }
  }

  static async createExamen(req, res) {
    try {
      const { nombre } = req.body;
      if (!nombre || !String(nombre).trim()) {
        return errorResponse(res, 'El campo nombre es obligatorio', 400);
      }
      const created = await prisma.evaluacionesExamen.create({
        data: { nombre: String(nombre).trim() }
      });
      return res.status(201).json({ success: true, data: created, message: 'Examen creado exitosamente' });
    } catch (error) {
      console.error('Error al crear examen:', error);
      return errorResponse(res, 'Error interno del servidor al crear examen');
    }
  }

  static async updateExamen(req, res) {
    try {
      const id = toInt(req.params.id);
      if (id == null) return errorResponse(res, 'id debe ser numérico', 400);
      const { nombre } = req.body;
      const existe = await prisma.evaluacionesExamen.findUnique({ where: { id } });
      if (!existe) return errorResponse(res, 'Examen no encontrado', 404);
      const data = {};
      if (nombre !== undefined) data.nombre = String(nombre).trim();
      const updated = await prisma.evaluacionesExamen.update({ where: { id }, data });
      return successResponse(res, updated, 'Examen actualizado exitosamente');
    } catch (error) {
      console.error('Error al actualizar examen:', error);
      return errorResponse(res, 'Error interno del servidor al actualizar examen');
    }
  }

  static async deleteExamen(req, res) {
    try {
      const id = toInt(req.params.id);
      if (id == null) return errorResponse(res, 'id debe ser numérico', 400);
      const existe = await prisma.evaluacionesExamen.findUnique({ where: { id } });
      if (!existe) return errorResponse(res, 'Examen no encontrado', 404);
      await prisma.evaluacionesExamen.delete({ where: { id } });
      return successResponse(res, null, 'Examen eliminado exitosamente');
    } catch (error) {
      if (error?.code === 'P2003') {
        return errorResponse(res, 'No se puede eliminar el examen: existen registros relacionados.', 409);
      }
      console.error('Error al eliminar examen:', error);
      return errorResponse(res, 'Error interno del servidor al eliminar examen');
    }
  }

  static async getResumenExamen(req, res) {
    try {
      const examenId = toInt(req.params.idExamen);
      if (examenId == null) return errorResponse(res, 'idExamen debe ser numérico', 400);
      const examen = await prisma.evaluacionesExamen.findUnique({ where: { id: examenId } });
      if (!examen) return errorResponse(res, `El examen ${examenId} no existe`, 404);

      const maxPosible = (await prisma.evaluacionesPreguntas.aggregate({
        _sum: { puntosMaximos: true },
        where: { idExamen: examenId }
      }))._sum.puntosMaximos || 0;

      const agg = await prisma.evaluacionesResultadosPorExamen.aggregate({
        _count: { id: true },
        _min: { calificacion: true },
        _max: { calificacion: true },
        _avg: { calificacion: true },
        where: { idExamen: examenId }
      });

      const respondidos = agg._count?.id ?? 0;
      const minPuntos = agg._min?.calificacion;
      const maxPuntos = agg._max?.calificacion;
      const avgPuntos = agg._avg?.calificacion;
      const porcentajeGlobal = maxPosible > 0 && avgPuntos != null ? Math.round((Number(avgPuntos) / maxPosible) * 1000) / 10 : null;

      const nivelesRows = await prisma.evaluacionesPreguntas.findMany({
        where: { idExamen: examenId },
        select: { nivel: true },
        distinct: ['nivel']
      });
      const niveles = nivelesRows.map(r => r.nivel).filter(Boolean);

      const porNivel = [];
      for (const nivel of niveles) {
        const maxPosibleNivel = (await prisma.evaluacionesPreguntas.aggregate({
          _sum: { puntosMaximos: true },
          where: { idExamen: examenId, nivel }
        }))._sum.puntosMaximos || 0;

        const respNivel = await prisma.evaluacionesRespuestas.findMany({
          where: { idExamen: examenId, nivel },
          select: { idColaborador: true, puntos: true }
        });
        const puntosPorColab = {};
        for (const r of respNivel) {
          const c = r.idColaborador ?? 'NULL';
          puntosPorColab[c] = (puntosPorColab[c] ?? 0) + Number(r.puntos ?? 0);
        }
        const vals = Object.values(puntosPorColab);
        const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        const minN = vals.length ? Math.min(...vals) : 0;
        const maxN = vals.length ? Math.max(...vals) : 0;
        const porcentajeNivel = maxPosibleNivel > 0 ? Math.round((avg / maxPosibleNivel) * 1000) / 10 : null;

        porNivel.push({
          nivel, puntajeMaximoPosible: maxPosibleNivel, porcentajeDePuntos: porcentajeNivel,
          minimoPuntos: minN, maximoPuntos: maxN, participantes: vals.length
        });
      }

      return successResponse(res, {
        examenId,
        participantesRespondieron: respondidos,
        participantesEsperados: respondidos,
        participantesFaltantes: 0,
        stats: {
          puntajeMaximoPosible: maxPosible, porcentajeDePuntos: porcentajeGlobal,
          minimoPuntos: minPuntos ?? null, maximoPuntos: maxPuntos ?? null,
          promedioPuntos: avgPuntos != null ? Math.round(Number(avgPuntos) * 10) / 10 : null
        },
        porNivel
      }, 'Resumen de examen generado');
    } catch (error) {
      console.error('Error en getResumenExamen:', error);
      return errorResponse(res, 'Error interno del servidor al generar el resumen del examen');
    }
  }

  static async getExamenesRealizadosPorColaborador(req, res) {
    try {
      const colab = String(req.params.idColaborador ?? '').trim();
      if (!colab) return errorResponse(res, 'idColaborador es obligatorio', 400);

      const resultados = await prisma.evaluacionesResultadosPorExamen.findMany({
        where: { idColaborador: colab },
        orderBy: { idExamen: 'asc' }
      });

      if (!resultados.length) {
        return successResponse(res, [], `El colaborador ${colab} aún no tiene exámenes realizados.`);
      }

      const examIds = [...new Set(resultados.map(r => r.idExamen))];
      const examenes = await prisma.evaluacionesExamen.findMany({
        where: { id: { in: examIds } },
        select: { id: true, nombre: true }
      });
      const mapaExamen = new Map(examenes.map(e => [e.id, e.nombre]));

      let colaboradorData = null;
      try {
        const simpliaMap = await getColaboradoresByIdColaborador([colab]);
        colaboradorData = simpliaMap.get(colab) ?? null;
      } catch { /* fallback — datos null */ }

      const data = resultados.map(r => ({
        examen: { id: r.idExamen, nombre: mapaExamen.get(r.idExamen) ?? null },
        resultado: {
          calificacion: r.calificacion ?? null, rango: r.rango ?? null,
          preguntasContestadas: r.preguntasContestadas ?? 0, ejerciciosContestados: r.ejerciciosContestados ?? 0
        },
        colaborador: colaboradorData ?? { idColaborador: colab }
      }));

      return successResponse(res, data, `Exámenes realizados por el colaborador ${colab} (${data.length}).`);
    } catch (error) {
      console.error('Error en getExamenesRealizadosPorColaborador:', error);
      return errorResponse(res, 'Error interno del servidor al obtener exámenes por colaborador');
    }
  }

  // ============================================================================
  // PREGUNTAS
  // ============================================================================

  static async getAllPreguntas(req, res) {
    try {
      const preguntas = await prisma.evaluacionesPreguntas.findMany();
      if (!preguntas.length) return successResponse(res, [], 'Aún no hay preguntas registradas.');
      return successResponse(res, preguntas, `Preguntas obtenidas exitosamente (${preguntas.length}).`);
    } catch (error) {
      console.error('Error al obtener preguntas:', error);
      return errorResponse(res, 'Error interno del servidor al obtener preguntas');
    }
  }

  static async getPreguntaById(req, res) {
    try {
      const id = toInt(req.params.id);
      if (id == null) return errorResponse(res, 'id debe ser numérico', 400);
      const pregunta = await prisma.evaluacionesPreguntas.findUnique({ where: { id } });
      if (!pregunta) return successResponse(res, null, 'Pregunta no encontrada');
      return successResponse(res, pregunta, 'Pregunta obtenida exitosamente');
    } catch (error) {
      console.error('Error al obtener pregunta por ID:', error);
      return errorResponse(res, 'Error interno del servidor al obtener pregunta');
    }
  }

  static async createPregunta(req, res) {
    try {
      const { pregunta, respuesta, puntosMaximos, idExamen, nivel, tipo } = req.body;
      if (pregunta == null || String(pregunta).trim() === '' || idExamen == null) {
        return errorResponse(res, 'Los campos pregunta e idExamen son obligatorios', 400);
      }
      const created = await prisma.evaluacionesPreguntas.create({
        data: {
          pregunta: String(pregunta).trim(),
          respuesta: respuesta != null ? String(respuesta).trim() : null,
          puntosMaximos: toInt(puntosMaximos),
          idExamen: toInt(idExamen),
          nivel: nivel ? String(nivel).trim() : null,
          tipo: tipo ? String(tipo).trim() : null,
        }
      });
      return res.status(201).json({ success: true, data: created, message: 'Pregunta creada exitosamente' });
    } catch (error) {
      console.error('Error al crear pregunta:', error);
      return errorResponse(res, 'Error interno del servidor al crear pregunta');
    }
  }

  static async bulkCreatePreguntas(req, res) {
    try {
      const payload = Array.isArray(req.body) ? req.body : req.body?.items;
      if (!Array.isArray(payload) || payload.length === 0) {
        return errorResponse(res, 'Envía un arreglo de preguntas en el body (o { items: [...] }).', 400);
      }
      const clean = payload.map(x => ({
        pregunta: String(x.pregunta ?? '').trim(),
        respuesta: x.respuesta != null ? String(x.respuesta).trim() : null,
        puntosMaximos: toInt(x.puntosMaximos),
        idExamen: toInt(x.idExamen),
        nivel: x.nivel != null ? String(x.nivel).trim() : null,
        tipo: x.tipo != null ? String(x.tipo).trim() : null,
      }));
      const invalidIdx = [];
      clean.forEach((o, i) => { if (!o.pregunta || o.idExamen == null) invalidIdx.push(i); });
      if (invalidIdx.length) {
        return res.status(400).json({ success: false, error: true, message: 'Hay preguntas con campos obligatorios faltantes.', invalidIndexes: invalidIdx });
      }

      const created = await prisma.$transaction(async (tx) => {
        const result = [];
        for (const item of clean) {
          const c = await tx.evaluacionesPreguntas.create({ data: item });
          result.push(c);
        }
        return result;
      });

      return res.status(201).json({ success: true, count: created.length, data: created, message: `Se crearon ${created.length} preguntas correctamente` });
    } catch (error) {
      console.error('Error al crear preguntas (bulk):', error);
      return errorResponse(res, 'Error interno del servidor al crear preguntas en bulk');
    }
  }

  static async updatePregunta(req, res) {
    try {
      const id = toInt(req.params.id);
      if (id == null) return errorResponse(res, 'id debe ser numérico', 400);
      const { pregunta, respuesta, puntosMaximos, idExamen, tipo, nivel } = req.body;
      const existe = await prisma.evaluacionesPreguntas.findUnique({ where: { id } });
      if (!existe) return errorResponse(res, 'Pregunta no encontrada', 404);
      const data = {};
      if (pregunta !== undefined) data.pregunta = String(pregunta).trim();
      if (respuesta !== undefined) data.respuesta = String(respuesta).trim();
      if (puntosMaximos !== undefined) data.puntosMaximos = toInt(puntosMaximos);
      if (idExamen !== undefined) data.idExamen = toInt(idExamen);
      if (tipo !== undefined) data.tipo = String(tipo).trim();
      if (nivel !== undefined) data.nivel = String(nivel).trim();
      const updated = await prisma.evaluacionesPreguntas.update({ where: { id }, data });
      return successResponse(res, updated, 'Pregunta actualizada exitosamente');
    } catch (error) {
      console.error('Error al actualizar pregunta:', error);
      return errorResponse(res, 'Error interno del servidor al actualizar pregunta');
    }
  }

  static async deletePregunta(req, res) {
    try {
      const id = toInt(req.params.id);
      if (id == null) return errorResponse(res, 'El parámetro id debe ser numérico', 400);
      const existe = await prisma.evaluacionesPreguntas.findUnique({ where: { id } });
      if (!existe) return errorResponse(res, 'Pregunta no encontrada', 404);
      await prisma.evaluacionesPreguntas.delete({ where: { id } });
      return successResponse(res, null, `Pregunta ${id} eliminada exitosamente`);
    } catch (error) {
      if (error?.code === 'P2003') return errorResponse(res, 'No se puede eliminar la pregunta: existen registros relacionados.', 409);
      console.error('Error al eliminar pregunta:', error);
      return errorResponse(res, 'Error interno del servidor al eliminar pregunta');
    }
  }

  static async deleteAllPreguntas(req, res) {
    try {
      const deleted = await prisma.evaluacionesPreguntas.deleteMany();
      return successResponse(res, { deleted: deleted.count }, deleted.count > 0 ? `Se eliminaron ${deleted.count} preguntas.` : 'No había preguntas para eliminar.');
    } catch (error) {
      if (error?.code === 'P2003') return errorResponse(res, 'No se pueden eliminar las preguntas: existen registros relacionados.', 409);
      console.error('Error al eliminar todas las preguntas:', error);
      return errorResponse(res, 'Error interno del servidor al eliminar todas las preguntas');
    }
  }

  static async getPreguntaConIncisosByIdExamen(req, res) {
    try {
      const examenId = toInt(req.params.idExamen);
      if (examenId == null) return errorResponse(res, 'idExamen debe ser numérico', 400);

      const examen = await prisma.evaluacionesExamen.findUnique({ where: { id: examenId } });
      if (!examen) return errorResponse(res, `El examen con id ${examenId} no existe`, 404);

      const preguntas = await prisma.evaluacionesPreguntas.findMany({
        where: { idExamen: examenId }
      });
      if (!preguntas.length) {
        return successResponse(res, [], `El examen ${examenId} existe pero aún no tiene preguntas registradas.`);
      }

      const preguntasConIncisos = await Promise.all(
        preguntas.map(async (pregunta) => {
          const incisos = await prisma.evaluacionesIncisos.findMany({
            where: { idPregunta: pregunta.id }
          });
          return {
            id: pregunta.id,
            pregunta: pregunta.pregunta,
            respuesta: pregunta.respuesta,
            puntosMaximos: pregunta.puntosMaximos,
            idExamen: pregunta.idExamen,
            nivel: pregunta.nivel,
            tipo: pregunta.tipo,
            incisos
          };
        })
      );

      return successResponse(res, preguntasConIncisos, 'Preguntas con incisos obtenidas exitosamente');
    } catch (error) {
      console.error('Error al obtener preguntas con incisos por idExamen:', error);
      return errorResponse(res, 'Error interno del servidor al obtener preguntas con incisos');
    }
  }

  // ============================================================================
  // INCISOS
  // ============================================================================

  static async getAllIncisos(req, res) {
    try {
      const idExamen = toInt(req.query.idExamen);
      const idPregunta = toInt(req.query.idPregunta);
      const where = {};
      if (idExamen != null) where.idExamen = idExamen;
      if (idPregunta != null) where.idPregunta = idPregunta;
      const incisos = await prisma.evaluacionesIncisos.findMany({ where });
      if (!incisos.length) {
        if (idExamen == null && idPregunta == null) {
          return successResponse(res, [], 'Aún no hay incisos registrados.');
        }
        return successResponse(res, [], `No existen incisos para los filtros especificados.`);
      }
      return successResponse(res, incisos, 'Incisos obtenidos exitosamente');
    } catch (error) {
      console.error('Error al obtener incisos:', error);
      return errorResponse(res, 'Error interno del servidor al obtener incisos');
    }
  }

  static async getInciso(req, res) {
    try {
      const idExamen = toInt(req.params.idExamen);
      const idPregunta = toInt(req.params.idPregunta);
      const letra = String(req.params.letra ?? '').trim();
      const inciso = await prisma.evaluacionesIncisos.findUnique({
        where: { idPregunta_letra: { idPregunta, letra } }
      });
      if (!inciso) return successResponse(res, null, 'Inciso no encontrado');
      return successResponse(res, inciso, 'Inciso obtenido exitosamente');
    } catch (error) {
      console.error('Error al obtener inciso:', error);
      return errorResponse(res, 'Error interno del servidor al obtener inciso');
    }
  }

  static async createInciso(req, res) {
    try {
      const { idExamen, idPregunta, letra, texto, puntos } = req.body;
      if (idExamen == null || idPregunta == null || !letra || !texto) {
        return errorResponse(res, 'Los campos idExamen, idPregunta, letra y texto son obligatorios', 400);
      }
      const created = await prisma.evaluacionesIncisos.create({
        data: {
          idExamen: toInt(idExamen),
          idPregunta: toInt(idPregunta),
          letra: String(letra).trim().slice(0, 5),
          texto: String(texto).trim(),
          puntos: toInt(puntos),
        }
      });
      return res.status(201).json({ success: true, data: created, message: 'Inciso creado exitosamente' });
    } catch (error) {
      console.error('Error al crear inciso:', error);
      return errorResponse(res, 'Error interno del servidor al crear inciso');
    }
  }

  static async bulkCreateIncisos(req, res) {
    try {
      const payload = Array.isArray(req.body) ? req.body : req.body?.items;
      if (!Array.isArray(payload) || payload.length === 0) {
        return errorResponse(res, 'Envía un arreglo de incisos en el body (o { items: [...] }).', 400);
      }
      const clean = payload.map(x => ({
        idExamen: toInt(x.idExamen),
        idPregunta: toInt(x.idPregunta),
        letra: String(x.letra ?? '').trim().slice(0, 5),
        texto: String(x.texto ?? '').trim(),
        puntos: toInt(x.puntos),
      }));
      const invalidIdx = [];
      clean.forEach((o, i) => { if (o.idExamen == null || o.idPregunta == null || !o.letra || !o.texto) invalidIdx.push(i); });
      if (invalidIdx.length) {
        return res.status(400).json({ success: false, error: true, message: 'Faltan campos obligatorios.', invalidIndexes: invalidIdx });
      }

      const created = await prisma.$transaction(async (tx) => {
        const result = [];
        for (const item of clean) {
          const c = await tx.evaluacionesIncisos.create({ data: item });
          result.push(c);
        }
        return result;
      });

      return res.status(201).json({ success: true, count: created.length, data: created, message: `Se crearon ${created.length} incisos correctamente` });
    } catch (error) {
      console.error('Error al crear incisos (bulk):', error);
      return errorResponse(res, 'Error interno del servidor al crear incisos en bulk');
    }
  }

  static async bulkAssignExamToIncisos(req, res) {
    try {
      const idExamen = toInt(req.body?.idExamen ?? 1);
      const rawItems = Array.isArray(req.body)
        ? req.body
        : (Array.isArray(req.body?.data) && req.body.data) ||
          (Array.isArray(req.body?.items) && req.body.items) || [];
      if (idExamen == null) return errorResponse(res, 'idExamen es requerido y debe ser numérico', 400);
      if (!Array.isArray(rawItems) || rawItems.length === 0) {
        return errorResponse(res, 'Envía un arreglo con incisos (data/items/array) con al menos { idPregunta, letra }', 400);
      }

      const items = rawItems.map(x => ({
        idPregunta: toInt(x.idPregunta),
        letra: String(x.letra ?? '').trim().slice(0, 5),
      }));
      const invalidIdx = [];
      items.forEach((it, i) => { if (it.idPregunta == null || !it.letra) invalidIdx.push(i); });
      if (invalidIdx.length) {
        return res.status(400).json({ success: false, error: true, message: 'Hay elementos sin idPregunta numérico o sin letra.', invalidIndexes: invalidIdx });
      }

      const result = await prisma.$transaction(async (tx) => {
        let updatedCount = 0;
        const notFound = [];
        for (const it of items) {
          try {
            const existing = await tx.evaluacionesIncisos.findUnique({
              where: { idPregunta_letra: { idPregunta: it.idPregunta, letra: it.letra } }
            });
            if (existing) {
              await tx.evaluacionesIncisos.update({
                where: { idPregunta_letra: { idPregunta: it.idPregunta, letra: it.letra } },
                data: { idExamen }
              });
              updatedCount++;
            } else {
              notFound.push({ idPregunta: it.idPregunta, letra: it.letra });
            }
          } catch {
            notFound.push({ idPregunta: it.idPregunta, letra: it.letra });
          }
        }
        return { updatedCount, notFound };
      });

      return successResponse(res, result, `Asignación de idExamen=${idExamen} completada`);
    } catch (error) {
      console.error('Error en bulkAssignExamToIncisos:', error);
      return errorResponse(res, 'Error interno del servidor al asignar idExamen a incisos de forma masiva');
    }
  }

  static async updateInciso(req, res) {
    try {
      const idPregunta = toInt(req.params.idPregunta);
      const letra = String(req.params.letra ?? '').trim();
      const { texto, puntos, idExamen } = req.body;
      const exists = await prisma.evaluacionesIncisos.findUnique({
        where: { idPregunta_letra: { idPregunta, letra } }
      });
      if (!exists) return errorResponse(res, 'Inciso no encontrado', 404);
      const data = {};
      if (texto !== undefined) data.texto = String(texto).trim();
      if (puntos !== undefined) data.puntos = toInt(puntos);
      if (idExamen !== undefined) data.idExamen = toInt(idExamen);
      const updated = await prisma.evaluacionesIncisos.update({
        where: { idPregunta_letra: { idPregunta, letra } },
        data
      });
      return successResponse(res, updated, 'Inciso actualizado exitosamente');
    } catch (error) {
      console.error('Error al actualizar inciso:', error);
      return errorResponse(res, 'Error interno del servidor al actualizar inciso');
    }
  }

  static async deleteInciso(req, res) {
    try {
      const idPregunta = toInt(req.params.idPregunta);
      const letra = String(req.params.letra ?? '').trim();
      await prisma.evaluacionesIncisos.delete({
        where: { idPregunta_letra: { idPregunta, letra } }
      });
      return successResponse(res, null, 'Inciso eliminado exitosamente');
    } catch (error) {
      if (error?.code === 'P2025') return errorResponse(res, 'Inciso no encontrado', 404);
      console.error('Error al eliminar inciso:', error);
      return errorResponse(res, 'Error interno del servidor al eliminar inciso');
    }
  }

  static async deleteAllIncisos(req, res) {
    try {
      const where = {};
      const idExamen = toInt(req.query.idExamen);
      const idPregunta = toInt(req.query.idPregunta);
      if (idExamen != null) where.idExamen = idExamen;
      if (idPregunta != null) where.idPregunta = idPregunta;
      const deleted = await prisma.evaluacionesIncisos.deleteMany({ where });
      return successResponse(res, { deletedCount: deleted.count }, 'Incisos eliminados exitosamente');
    } catch (error) {
      console.error('Error al eliminar incisos:', error);
      return errorResponse(res, 'Error interno del servidor al eliminar incisos');
    }
  }

  // ============================================================================
  // RANKING
  // ============================================================================

  static async getAllRankings(req, res) {
    try {
      const where = {};
      if (req.query.idColaborador) {
        where.idColaborador = String(req.query.idColaborador).trim();
      }
      const items = await prisma.evaluacionesRanking.findMany({
        where,
        orderBy: [
          { puntos: 'desc' },
          { examenesRealizados: 'desc' },
          { ultimaActualizacion: 'desc' }
        ]
      });
      if (!items.length) return successResponse(res, [], 'Aún no hay rankings registrados.');

      const colabIds = [...new Set(items.map(r => r.idColaborador).filter(Boolean))];
      let simpliaMap = new Map();
      if (colabIds.length) {
        try {
          simpliaMap = await getColaboradoresByIdColaborador(colabIds);
        } catch { /* fallback */ }
      }

      const data = items.map(item => {
        const col = simpliaMap.get(item.idColaborador);
        return {
          ...item,
          names: col?.names ?? null,
          lastNames: col?.lastNames ?? null,
          correo: col?.correo ?? null,
          area: col?.area ?? null,
          puesto: col?.puesto ?? null,
          foto: col?.foto ?? null,
        };
      });

      return successResponse(res, data, `Ranking obtenido exitosamente (${data.length}).`);
    } catch (error) {
      console.error('Error al obtener ranking:', error);
      return errorResponse(res, 'Error interno del servidor al obtener ranking');
    }
  }

  static async getRankingsPorExamen(req, res) {
    try {
      const examenId = toInt(req.params.idExamen);
      if (examenId == null) return errorResponse(res, 'idExamen debe ser numérico', 400);
      const items = await prisma.evaluacionesRankingPorExamen.findMany({
        where: { idExamen: examenId },
        orderBy: [{ puntos: 'desc' }, { ultimaActualizacion: 'desc' }]
      });
      return successResponse(res, items, `Ranking por examen ${examenId} (${items.length}).`);
    } catch (error) {
      console.error('getRankingsPorExamen error:', error);
      return errorResponse(res, 'Error interno al obtener ranking por examen');
    }
  }

  static async getRankingById(req, res) {
    try {
      const id = toInt(req.params.id);
      if (id == null) return errorResponse(res, 'id debe ser numérico', 400);
      const item = await prisma.evaluacionesRanking.findUnique({ where: { id } });
      if (!item) return successResponse(res, null, 'Registro de ranking no encontrado');
      return successResponse(res, item, 'Registro de ranking obtenido exitosamente');
    } catch (error) {
      console.error('Error al obtener ranking por ID:', error);
      return errorResponse(res, 'Error interno del servidor al obtener ranking');
    }
  }

  static async updateRanking(req, res) {
    try {
      const id = toInt(req.params.id);
      if (id == null) return errorResponse(res, 'id debe ser numérico', 400);
      const { idColaborador, rango, puntos, examenesRealizados } = req.body;
      const existe = await prisma.evaluacionesRanking.findUnique({ where: { id } });
      if (!existe) return errorResponse(res, 'Registro de ranking no encontrado', 404);
      const data = {};
      if (idColaborador !== undefined) data.idColaborador = String(idColaborador).trim();
      if (rango !== undefined) data.rango = String(rango).trim();
      if (puntos !== undefined) data.puntos = toInt(puntos);
      if (examenesRealizados !== undefined) data.examenesRealizados = toInt(examenesRealizados);
      data.ultimaActualizacion = new Date();
      const updated = await prisma.evaluacionesRanking.update({ where: { id }, data });
      return successResponse(res, updated, 'Registro de ranking actualizado exitosamente');
    } catch (error) {
      console.error('Error al actualizar ranking:', error);
      return errorResponse(res, 'Error interno del servidor al actualizar ranking');
    }
  }

  static async deleteRanking(req, res) {
    try {
      const raw = req.params.id;
      if (raw == null || String(raw).trim() === '') {
        return errorResponse(res, 'Parámetro requerido (id numérico o idColaborador string)', 400);
      }
      const text = String(raw).trim();
      const isNumeric = /^\d+$/.test(text);
      let item;
      if (isNumeric) {
        item = await prisma.evaluacionesRanking.findUnique({ where: { id: parseInt(text, 10) } });
      } else {
        item = await prisma.evaluacionesRanking.findFirst({ where: { idColaborador: text } });
      }
      if (!item) return errorResponse(res, 'Registro de ranking no encontrado', 404);
      await prisma.evaluacionesRanking.delete({ where: { id: item.id } });
      return successResponse(res, null, 'Registro de ranking eliminado exitosamente');
    } catch (error) {
      if (error?.code === 'P2003') return errorResponse(res, 'No se puede eliminar: existen registros relacionados.', 409);
      console.error('Error al eliminar ranking:', error);
      return errorResponse(res, 'Error interno del servidor al eliminar ranking');
    }
  }

  static async bulkCargarRankingPorExamen(req, res) {
    try {
      const idExamen = toInt(req.body?.idExamen) || 1;
      const src = Array.isArray(req.body?.items) ? req.body.items : [];
      if (src.length === 0) {
        return errorResponse(res, 'Debes enviar items a insertar.', 400);
      }
      const cleaned = src.map(x => ({
        idColaborador: String(x.idColaborador || '').trim(),
        idExamen,
        rango: x.rango ?? null,
        puntos: Number.isFinite(Number(x.puntos)) ? Number(x.puntos) : 0,
      })).filter(x => x.idColaborador);

      if (cleaned.length === 0) {
        return errorResponse(res, 'Ningún item válido (idColaborador vacío).', 400);
      }

      await prisma.$transaction(async (tx) => {
        await tx.evaluacionesRankingPorExamen.deleteMany({ where: { idExamen } });
        const now = new Date();
        for (const r of cleaned) {
          await tx.evaluacionesRankingPorExamen.create({
            data: {
              idColaborador: r.idColaborador,
              idExamen: r.idExamen,
              rango: r.rango,
              puntos: r.puntos,
              fechaInicio: now,
              ultimaActualizacion: now,
            }
          });
        }
      });

      return successResponse(res, null, `Insertados ${cleaned.length} registros en RankingPorExamen para el examen ${idExamen}.`);
    } catch (error) {
      console.error('Error en bulkCargarRankingPorExamen:', error);
      return errorResponse(res, 'Error interno al hacer el bulk de RankingPorExamen: ' + error.message);
    }
  }

  // ============================================================================
  // RESULTADOS POR EXAMEN
  // ============================================================================

  static async getAllResultados(req, res) {
    try {
      const where = {};
      if (req.query.idColaborador !== undefined) {
        const colab = String(req.query.idColaborador).trim();
        if (!colab) return errorResponse(res, 'idColaborador (query) no puede estar vacío', 400);
        where.idColaborador = colab;
      }
      if (req.query.idExamen !== undefined) {
        const examenId = toInt(req.query.idExamen);
        if (examenId == null) return errorResponse(res, 'idExamen (query) debe ser numérico', 400);
        where.idExamen = examenId;
      }
      const items = await prisma.evaluacionesResultadosPorExamen.findMany({ where });
      if (!items.length) return successResponse(res, [], 'Aún no hay resultados registrados.');
      return successResponse(res, items, `Resultados obtenidos exitosamente (${items.length}).`);
    } catch (error) {
      console.error('Error al obtener resultados:', error);
      return errorResponse(res, 'Error interno del servidor al obtener resultados');
    }
  }

  static async getResultadoById(req, res) {
    try {
      const id = toInt(req.params.id);
      if (id == null) return errorResponse(res, 'id debe ser numérico', 400);
      const item = await prisma.evaluacionesResultadosPorExamen.findUnique({ where: { id } });
      if (!item) return successResponse(res, null, 'Resultado no encontrado');
      return successResponse(res, item, 'Resultado obtenido exitosamente');
    } catch (error) {
      console.error('Error al obtener resultado por ID:', error);
      return errorResponse(res, 'Error interno del servidor al obtener resultado');
    }
  }

  static async updateResultado(req, res) {
    try {
      const id = toInt(req.params.id);
      if (id == null) return errorResponse(res, 'id debe ser numérico', 400);
      const { calificacion, rango, preguntasContestadas, ejerciciosContestados, idColaborador, idExamen } = req.body;
      const existe = await prisma.evaluacionesResultadosPorExamen.findUnique({ where: { id } });
      if (!existe) return errorResponse(res, 'Resultado no encontrado', 404);
      const data = {};
      if (calificacion !== undefined) data.calificacion = toInt(calificacion);
      if (rango !== undefined) data.rango = String(rango).trim();
      if (preguntasContestadas !== undefined) data.preguntasContestadas = toInt(preguntasContestadas);
      if (ejerciciosContestados !== undefined) data.ejerciciosContestados = toInt(ejerciciosContestados);
      if (idColaborador !== undefined) data.idColaborador = String(idColaborador).trim();
      if (idExamen !== undefined) data.idExamen = toInt(idExamen);
      const updated = await prisma.evaluacionesResultadosPorExamen.update({ where: { id }, data });
      return successResponse(res, updated, 'Resultado actualizado exitosamente');
    } catch (error) {
      console.error('Error al actualizar resultado:', error);
      return errorResponse(res, 'Error interno del servidor al actualizar resultado');
    }
  }

  static async deleteResultado(req, res) {
    try {
      const id = toInt(req.params.id);
      if (id == null) return errorResponse(res, 'id debe ser numérico', 400);
      const existe = await prisma.evaluacionesResultadosPorExamen.findUnique({ where: { id } });
      if (!existe) return errorResponse(res, 'Resultado no encontrado', 404);
      await prisma.evaluacionesResultadosPorExamen.delete({ where: { id } });
      return successResponse(res, null, 'Resultado eliminado exitosamente');
    } catch (error) {
      console.error('Error al eliminar resultado:', error);
      return errorResponse(res, 'Error interno del servidor al eliminar resultado');
    }
  }

  static async getResultadosByExamen(req, res) {
    try {
      const examenId = toInt(req.params.idExamen);
      if (examenId == null) return errorResponse(res, 'idExamen debe ser numérico', 400);
      const resultados = await prisma.evaluacionesResultadosPorExamen.findMany({
        where: { idExamen: examenId }
      });
      return successResponse(res, resultados, 'Resultados filtrados por idExamen');
    } catch (error) {
      console.error('Error al obtener resultados por idExamen:', error);
      return errorResponse(res, 'Error interno del servidor al obtener resultados por idExamen');
    }
  }

  static async getResultadosByExamenYColaborador(req, res) {
    try {
      const examenId = toInt(req.params.idExamen);
      if (examenId == null) return errorResponse(res, 'idExamen debe ser numérico', 400);
      const colab = String(req.params.idColaborador ?? '').trim();
      if (!colab) return errorResponse(res, 'idColaborador es obligatorio', 400);

      const resultados = await prisma.evaluacionesResultadosPorExamen.findMany({
        where: { idExamen: examenId, idColaborador: colab }
      });
      if (!resultados.length) {
        return successResponse(res, [], `Aún no hay resultados para el examen ${examenId} del colaborador ${colab}.`);
      }
      const data = resultados.map(r => ({
        ...r, job: null, area: null, names: null, lastnames: null, location: null
      }));
      return successResponse(res, data, `Resultados filtrados por idExamen (${examenId}) e idColaborador (${colab}).`);
    } catch (error) {
      console.error('Error al obtener resultados por examen y colaborador:', error);
      return errorResponse(res, 'Error interno del servidor al obtener resultados por examen y colaborador');
    }
  }

  static async getResultadosByColaborador(req, res) {
    try {
      const colab = String(req.params.idColaborador ?? '').trim();
      if (!colab) return errorResponse(res, 'idColaborador es obligatorio', 400);
      const where = { idColaborador: colab };
      if (req.query.idExamen) where.idExamen = toInt(req.query.idExamen);
      const resultados = await prisma.evaluacionesResultadosPorExamen.findMany({ where });
      return successResponse(res, resultados, 'Resultados filtrados por idColaborador');
    } catch (error) {
      console.error('Error al obtener resultados por idColaborador:', error);
      return errorResponse(res, 'Error interno del servidor al obtener resultados por idColaborador');
    }
  }

  // ============================================================================
  // ANALYTICS - Preguntas No Contestadas
  // ============================================================================

  static async getPreguntasNoContestadasPorExamen(req, res) {
    try {
      const examenId = toInt(req.params.idExamen);
      if (examenId == null) return errorResponse(res, 'idExamen debe ser numérico', 400);

      const examen = await prisma.evaluacionesExamen.findUnique({ where: { id: examenId } });
      if (!examen) return errorResponse(res, `El examen ${examenId} no existe`, 404);

      const preguntas = await prisma.evaluacionesPreguntas.findMany({
        where: { idExamen: examenId },
        select: { id: true, nivel: true, tipo: true }
      });
      if (!preguntas.length) {
        return successResponse(res, [], `El examen ${examenId} no tiene preguntas registradas.`);
      }

      const byLevel = preguntas.reduce((acc, p) => {
        const nivel = (p.nivel || '').trim();
        if (!acc[nivel]) acc[nivel] = { all: [], qs: [], ex: [] };
        acc[nivel].all.push(p.id);
        if ((p.tipo || '').toUpperCase() === 'EJERCICIO') acc[nivel].ex.push(p.id);
        else acc[nivel].qs.push(p.id);
        return acc;
      }, {});

      const finalesIds = byLevel['FINALES']?.all || [];
      const entryQs = byLevel['ENTRY']?.qs || [];
      const entryExercises = byLevel['ENTRY']?.ex || [];
      const nivel1Qs = byLevel['NIVEL_1']?.qs || [];
      const nivel1Ex = byLevel['NIVEL_1']?.ex || [];
      const nivel2Qs = byLevel['NIVEL_2']?.qs || [];
      const nivel2Ex = byLevel['NIVEL_2']?.ex || [];
      const entryFirstId = entryQs.length ? Math.min(...entryQs) : null;

      const allResps = await prisma.evaluacionesRespuestas.findMany({
        where: { idExamen: examenId },
        select: { idColaborador: true, idPregunta: true, nivel: true, puntos: true, tipo: true }
      });

      if (!allResps.length) {
        return successResponse(res, [], `Aún no hay respuestas registradas para el examen ${examenId}.`);
      }

      const onlyColab = req.query.idColaborador ? String(req.query.idColaborador).trim() : null;

      const byColab = new Map();
      for (const r of allResps) {
        if (onlyColab && r.idColaborador !== onlyColab) continue;
        const key = r.idColaborador || null;
        if (!key) continue;
        if (!byColab.has(key)) {
          byColab.set(key, {
            resp: new Set(),
            sum: { ENTRY: 0, NIVEL_1: 0, NIVEL_2: 0, NIVEL_3: 0 },
            has: { exENTRY: false, exN1: false, exN2: false, exN3: false },
            puntosByQ: new Map(),
          });
        }
        const e = byColab.get(key);
        e.resp.add(r.idPregunta);
        e.puntosByQ.set(r.idPregunta, Number(r.puntos || 0));
        const nivel = (r.nivel || '').trim().toUpperCase();
        const tipo = (r.tipo || '').trim().toUpperCase();
        const isEj = tipo === 'EJERCICIO' || byLevel[nivel]?.ex?.includes(r.idPregunta);
        if (!isEj) {
          if (nivel === 'ENTRY') e.sum.ENTRY += Number(r.puntos || 0);
          if (nivel === 'NIVEL_1') e.sum.NIVEL_1 += Number(r.puntos || 0);
          if (nivel === 'NIVEL_2') e.sum.NIVEL_2 += Number(r.puntos || 0);
          if (nivel === 'NIVEL_3') e.sum.NIVEL_3 += Number(r.puntos || 0);
        } else {
          if (nivel === 'ENTRY') e.has.exENTRY = true;
          if (nivel === 'NIVEL_1') e.has.exN1 = true;
          if (nivel === 'NIVEL_2') e.has.exN2 = true;
          if (nivel === 'NIVEL_3') e.has.exN3 = true;
        }
      }

      if (onlyColab && !byColab.size) {
        return successResponse(res, [], `El colaborador ${onlyColab} no tiene respuestas registradas en el examen ${examenId}.`);
      }

      const resultados = [];
      for (const [idColaborador, E] of byColab.entries()) {
        const esperadas = new Set();
        finalesIds.forEach(id => esperadas.add(id));

        if (entryQs.length || entryExercises.length) {
          let saltoDirectoFinalesPorEntry = false;
          if (entryFirstId && E.puntosByQ.has(entryFirstId)) {
            if (E.puntosByQ.get(entryFirstId) === 0) {
              esperadas.add(entryFirstId);
              saltoDirectoFinalesPorEntry = true;
            }
          }
          if (!saltoDirectoFinalesPorEntry) {
            entryQs.forEach(id => esperadas.add(id));
            if (E.has.exENTRY) entryExercises.forEach(id => esperadas.add(id));
          }
        }

        const totalSinEjHastaN1 = E.sum.ENTRY + E.sum.NIVEL_1;
        const totalSinEjHastaN2 = totalSinEjHastaN1 + E.sum.NIVEL_2;

        const saltoPorEntry = entryFirstId && E.puntosByQ.has(entryFirstId) && E.puntosByQ.get(entryFirstId) === 0;
        if (!saltoPorEntry && (nivel1Qs.length || nivel1Ex.length)) {
          const alcanzoN1 = E.sum.NIVEL_1 > 0 || allResps.some(r => r.idColaborador === idColaborador && (r.nivel || '').toUpperCase() === 'NIVEL_1');
          if (alcanzoN1) {
            nivel1Qs.forEach(id => esperadas.add(id));
            if (totalSinEjHastaN1 > 14) nivel1Ex.forEach(id => esperadas.add(id));
          }
        }

        if (!saltoPorEntry && (nivel2Qs.length || nivel2Ex.length) && totalSinEjHastaN1 > 14) {
          const alcanzoN2 = E.sum.NIVEL_2 > 0 || allResps.some(r => r.idColaborador === idColaborador && (r.nivel || '').toUpperCase() === 'NIVEL_2');
          if (alcanzoN2) {
            nivel2Qs.forEach(id => esperadas.add(id));
            if (totalSinEjHastaN2 > 40) nivel2Ex.forEach(id => esperadas.add(id));
          }
        }

        if (!saltoPorEntry && (byLevel['NIVEL_3']?.qs?.length || byLevel['NIVEL_3']?.ex?.length) && totalSinEjHastaN2 > 40) {
          const alcanzoN3 = E.sum.NIVEL_3 > 0 || allResps.some(r => r.idColaborador === idColaborador && (r.nivel || '').toUpperCase() === 'NIVEL_3');
          if (alcanzoN3) {
            (byLevel['NIVEL_3']?.qs || []).forEach(id => esperadas.add(id));
          }
        }

        const faltan = [];
        for (const qId of esperadas) {
          if (!E.resp.has(qId)) faltan.push(qId);
        }

        resultados.push({
          idColaborador,
          names: null,
          lastNames: null,
          area: null,
          jobTitle: null,
          location: null,
          foto: null,
          totales: {
            esperadas: esperadas.size,
            contestadas: E.resp.size,
            faltantes: faltan.length,
          },
          preguntasNoContestadas: faltan.sort((a, b) => a - b),
        });
      }

      resultados.sort((a, b) => b.totales.faltantes - a.totales.faltantes);
      return successResponse(res, resultados, `Cálculo de preguntas no contestadas para examen ${examenId}${onlyColab ? ` (colaborador ${onlyColab})` : ''}.`);
    } catch (error) {
      console.error('Error en getPreguntasNoContestadasPorExamen:', error);
      return errorResponse(res, 'Error interno del servidor al calcular preguntas no contestadas');
    }
  }

  // ============================================================================
  // ANALYTICS - Análisis por pregunta
  // ============================================================================

  static async getAnalisisPorPreguntaByExamen(req, res) {
    try {
      const examenId = toInt(req.params.idExamen);
      if (examenId == null) return errorResponse(res, 'idExamen debe ser numérico', 400);

      const [rows] = await prisma.$queryRaw`
        WITH pos_counts AS (
          SELECT r.idPregunta, r.posicion, COUNT(*) AS cnt,
            ROW_NUMBER() OVER (PARTITION BY r.idPregunta ORDER BY COUNT(*) DESC, MIN(r.id) ASC) AS rn
          FROM [Evaluaciones].[Respuestas] r WITH (NOLOCK)
          WHERE r.idExamen = ${examenId} AND r.posicion IS NOT NULL
          GROUP BY r.idPregunta, r.posicion
        ),
        resp_counts AS (
          SELECT r.idPregunta, r.respuesta, COUNT(*) AS cnt,
            ROW_NUMBER() OVER (PARTITION BY r.idPregunta ORDER BY COUNT(*) DESC, MIN(r.id) ASC) AS rn
          FROM [Evaluaciones].[Respuestas] r WITH (NOLOCK)
          WHERE r.idExamen = ${examenId}
          GROUP BY r.idPregunta, r.respuesta
        ),
        puntos_agg AS (
          SELECT r.idPregunta,
            AVG(CAST(r.puntos AS float)) AS avgPuntos,
            COUNT(*) AS totalRespuestas
          FROM [Evaluaciones].[Respuestas] r WITH (NOLOCK)
          WHERE r.idExamen = ${examenId}
          GROUP BY r.idPregunta
        )
        SELECT
          p.id AS idPregunta, p.pregunta,
          pc.posicion AS posicionMasElegida,
          rc.respuesta AS incisoMasElegidoTexto,
          CAST(pa.avgPuntos AS float) AS promedioPuntos,
          pa.totalRespuestas AS totalRespuestas
        FROM [Evaluaciones].[preguntas] p WITH (NOLOCK)
        LEFT JOIN puntos_agg pa ON pa.idPregunta = p.id
        LEFT JOIN pos_counts pc ON pc.idPregunta = p.id AND pc.rn = 1
        LEFT JOIN resp_counts rc ON rc.idPregunta = p.id AND rc.rn = 1
        WHERE p.idExamen = ${examenId}
        ORDER BY p.id ASC;
      `;

      if (!rows || rows.length === 0) {
        return successResponse(res, [], `No hay preguntas/respuestas registradas para el examen ${examenId}.`);
      }

      const data = rows.map(r => ({
        idPregunta: r.idPregunta,
        pregunta: r.pregunta,
        incisoMasElegido: { texto: r.incisoMasElegidoTexto ?? null },
        promedioPuntos: r.promedioPuntos != null ? Math.round(Number(r.promedioPuntos) * 10) / 10 : null,
        totalRespuestas: r.totalRespuestas != null ? Number(r.totalRespuestas) : 0,
      }));

      return successResponse(res, data, `Análisis por pregunta del examen ${examenId}.`);
    } catch (error) {
      console.error('Error en análisis por pregunta:', error);
      return errorResponse(res, 'Error interno del servidor al analizar preguntas por examen');
    }
  }

  // ============================================================================
  // ANALYTICS - Faltantes por responder (simplificado)
  // ============================================================================

  static async getFaltantesPorResponder(req, res) {
    try {
      const examenId = toInt(req.params.idExamen);
      if (examenId == null) return errorResponse(res, 'idExamen debe ser numérico', 400);

      const responded = await prisma.evaluacionesResultadosPorExamen.findMany({
        where: { idExamen: examenId },
        select: { idColaborador: true },
        distinct: ['idColaborador']
      });
      const respondedIds = new Set(responded.map(r => r.idColaborador).filter(Boolean));

      const allRespuestasColabs = await prisma.evaluacionesRespuestas.findMany({
        where: { idExamen: examenId },
        select: { idColaborador: true },
        distinct: ['idColaborador']
      });
      const allColabIds = new Set(allRespuestasColabs.map(r => r.idColaborador).filter(Boolean));

      const missingIds = [...allColabIds].filter(id => !respondedIds.has(id));

      let simpliaMap = new Map();
      if (missingIds.length) {
        try {
          simpliaMap = await getColaboradoresByIdColaborador(missingIds);
        } catch { /* fallback */ }
      }

      const data = missingIds.map(id => {
        const col = simpliaMap.get(id);
        return {
          idColaborador: id,
          correo: col?.correo ?? null,
          area: col?.area ?? null,
          jobTitle: col?.puesto ?? null,
          names: col?.names ?? null,
          lastNames: col?.lastNames ?? null,
          location: null,
        };
      });

      return successResponse(res, data, `Faltantes obtenidos exitosamente (${data.length}).`);
    } catch (error) {
      console.error('Error al obtener faltantes por responder:', error);
      return errorResponse(res, 'Error interno del servidor al obtener faltantes por responder');
    }
  }

  // ============================================================================
  // ANALYTICS - Resumen por áreas (simplificado)
  // ============================================================================

  static async getResumenPorAreas(req, res) {
    try {
      const exam = req.query.idExamen ? toInt(req.query.idExamen) : null;

      const where = {};
      if (exam != null) where.idExamen = exam;

      const rows = await prisma.evaluacionesResultadosPorExamen.findMany({ where });

      if (!rows.length) {
        return successResponse(res, [], exam ? `No hay resultados para el examen ${exam}.` : 'No hay resultados registrados.');
      }

      const areasMap = new Map();
      areasMap.set('GENERAL', {
        promedioCalificacion: 0, colaboradores: new Set(),
        rangos: { explorador: 0, pionero: 0, adoptador: 0, integrador: 0 },
        totalPuntos: 0
      });

      for (const r of rows) {
        const bucket = areasMap.get('GENERAL');
        bucket.colaboradores.add(r.idColaborador);
        bucket.totalPuntos += Number(r.calificacion ?? 0);
        const rangoKey = (r.rango || '').toLowerCase();
        if (bucket.rangos[rangoKey] !== undefined) bucket.rangos[rangoKey]++;
      }

      const bucket = areasMap.get('GENERAL');
      bucket.promedioCalificacion = bucket.colaboradores.size > 0
        ? Math.round((bucket.totalPuntos / bucket.colaboradores.size) * 10) / 10
        : 0;

      const data = [{
        area: 'GENERAL',
        promedioCalificacion: bucket.promedioCalificacion,
        colaboradores: bucket.colaboradores.size,
        rangos: bucket.rangos,
        puestoRankingArea: 1,
      }];

      return successResponse(res, data, `Resumen global${exam ? ` para idExamen ${exam}` : ''} obtenido exitosamente.`);
    } catch (error) {
      console.error('Error en getResumenPorAreas:', error);
      return errorResponse(res, 'Error interno del servidor al obtener resumen por área');
    }
  }

  static async getResumenPorArea(req, res) {
    try {
      const exam = req.query.idExamen ? toInt(req.query.idExamen) : null;
      const area = String(req.params.area ?? '').trim();
      if (!area) return errorResponse(res, 'El parámetro :area es obligatorio', 400);

      const where = {};
      if (exam != null) where.idExamen = exam;

      const rows = await prisma.evaluacionesResultadosPorExamen.findMany({ where });

      if (!rows.length) {
        return successResponse(res, { area, resumen: null, ranking: [] },
          exam ? `No hay resultados para el área "${area}" en el examen ${exam}.` : `No hay resultados para el área "${area}".`);
      }

      const totalPuntos = rows.reduce((s, r) => s + Number(r.calificacion ?? 0), 0);
      const colaboradores = rows.length;
      const rangos = { explorador: 0, pionero: 0, adoptador: 0, integrador: 0 };
      for (const r of rows) {
        const k = (r.rango || '').toLowerCase();
        if (rangos[k] !== undefined) rangos[k]++;
      }

      const resumen = {
        area,
        promedioCalificacion: colaboradores > 0 ? Math.round((totalPuntos / colaboradores) * 10) / 10 : 0,
        colaboradores,
        rangos,
      };

      const ranking = rows.map((r, i) => {
        const pts = Number(r.calificacion ?? 0);
        let rangoCalc = 'Explorador';
        if (pts > 30 && pts <= 60) rangoCalc = 'Pionero';
        else if (pts > 60 && pts <= 89) rangoCalc = 'Adoptador';
        else if (pts > 89) rangoCalc = 'Integrador';
        return { posicion: i + 1, idColaborador: r.idColaborador, nombres: null, apellidos: null, location: null, job: null, area, puntos: pts, rango: rangoCalc };
      });

      // Enriquecer ranking con datos de Simplia
      const colabIds = [...new Set(rows.map(r => r.idColaborador).filter(Boolean))];
      if (colabIds.length) {
        try {
          const simpliaMap = await getColaboradoresByIdColaborador(colabIds);
          for (const item of ranking) {
            const col = simpliaMap.get(item.idColaborador);
            if (col) {
              item.nombres = col.names;
              item.apellidos = col.lastNames;
              item.correo = col.correo;
              item.job = col.puesto;
            }
          }
        } catch { /* fallback — datos null */ }
      }

      return successResponse(res, { area, resumen, ranking }, `Resumen de área "${area}"${exam ? ` para idExamen ${exam}` : ''} obtenido exitosamente.`);
    } catch (error) {
      console.error('Error en getResumenPorArea:', error);
      return errorResponse(res, 'Error interno del servidor al obtener resumen del área');
    }
  }

  static async getResumenRespuestasPorArea(req, res) {
    try {
      const examenId = toInt(req.params.idExamen);
      if (examenId == null) return errorResponse(res, 'idExamen debe ser numérico', 400);

      const respondedRows = await prisma.evaluacionesResultadosPorExamen.findMany({
        where: { idExamen: examenId },
        select: { idColaborador: true }
      });
      const respondedSet = new Set(respondedRows.map(r => r.idColaborador));

      const allRespColabs = await prisma.evaluacionesRespuestas.findMany({
        where: { idExamen: examenId },
        select: { idColaborador: true },
        distinct: ['idColaborador']
      });
      const allColabIds = new Set(allRespColabs.map(r => r.idColaborador).filter(Boolean));

      const responded = [...allColabIds].filter(id => respondedSet.has(id));
      const missing = [...allColabIds].filter(id => !respondedSet.has(id));

      const data = [{
        area: 'GENERAL',
        respondieron: responded.length,
        faltan: missing.length,
        listaRespondieron: responded.map(id => ({ idColaborador: id, names: null, lastNames: null })),
        listaFaltantes: missing.map(id => ({ idColaborador: id, names: null, lastNames: null })),
      }];

      const totalActivos = allColabIds.size;
      return res.json({
        success: true,
        summary: { totalActivos, respondieron: respondedSet.size, faltan: Math.max(totalActivos - respondedSet.size, 0) },
        data,
        message: `Resumen por área generado (${data.length} áreas).`,
      });
    } catch (error) {
      console.error('Error en getResumenRespuestasPorArea:', error);
      return errorResponse(res, 'Error interno del servidor al generar el resumen por área');
    }
  }

  static async getRespondieronExamen(req, res) {
    try {
      const examenId = toInt(req.params.idExamen);
      if (examenId == null) return errorResponse(res, 'idExamen debe ser numérico', 400);

      const resultados = await prisma.evaluacionesResultadosPorExamen.findMany({
        where: { idExamen: examenId },
        orderBy: { calificacion: 'desc' }
      });

      if (!resultados.length) {
        return successResponse(res, [], 'Nadie ha respondido este examen todavía.');
      }

      const data = resultados.map(r => ({
        id: r.id,
        idExamen: r.idExamen,
        idColaborador: r.idColaborador,
        calificacion: r.calificacion,
        rango: r.rango,
        preguntasContestadas: r.preguntasContestadas,
        ejerciciosContestados: r.ejerciciosContestados,
        area: null,
        jobTitle: null,
        names: null,
        lastNames: null,
        location: null,
      }));

      return successResponse(res, data, `Respondieron el examen (${data.length}).`);
    } catch (error) {
      console.error('Error al obtener respondieron examen:', error);
      return errorResponse(res, 'Error interno del servidor al obtener respondientes del examen');
    }
  }

  // ============================================================================
  // ANALYTICS - Análisis de posiciones
  // ============================================================================

  static async getAnalisisPosicionesByExamenColaborador(req, res) {
    try {
      const examenId = toInt(req.params.idExamen);
      if (examenId == null) return errorResponse(res, 'idExamen debe ser numérico', 400);
      const where = { idExamen: examenId };
      let colab = req.params.idColaborador ?? req.query.idColaborador;
      if (colab !== undefined) {
        colab = String(colab).trim();
        if (!colab) return errorResponse(res, 'idColaborador no puede estar vacío', 400);
        where.idColaborador = colab;
      }

      const rows = await prisma.evaluacionesRespuestas.findMany({
        where,
        select: { idColaborador: true, posicion: true },
        orderBy: [{ idColaborador: 'asc' }, { id: 'asc' }]
      });

      if (!rows.length) {
        const detalle = where.idColaborador ? `para el examen ${examenId} y el colaborador ${where.idColaborador}` : `para el examen ${examenId}`;
        return successResponse(res, [], `Aún no hay respuestas registradas ${detalle}.`);
      }

      const analizaPosiciones = (posiciones) => {
        const total = posiciones.length;
        if (!total) return { totalRespuestas: 0, posicionesUnicas: 0, posicionMasFrecuente: null, porcentajeMasFrecuente: 0, usaSiempreMismaPosicion: false, usaMayormenteMismaPosicion: false, distribucion: [] };
        const conteo = new Map();
        for (const p of posiciones) { if (p != null) conteo.set(p, (conteo.get(p) || 0) + 1); }
        const distribucion = Array.from(conteo.entries()).sort((a, b) => b[1] - a[1]).map(([pos, count]) => ({ posicion: pos, conteo: count, porcentaje: Math.round((count / total) * 1000) / 10 }));
        const unicas = conteo.size;
        const mf = distribucion[0] || { posicion: null, conteo: 0, porcentaje: 0 };
        return { totalRespuestas: total, posicionesUnicas: unicas, posicionMasFrecuente: mf.posicion, porcentajeMasFrecuente: mf.porcentaje, usaSiempreMismaPosicion: unicas === 1, usaMayormenteMismaPosicion: mf.porcentaje >= 80, distribucion };
      };

      if (where.idColaborador) {
        const posiciones = rows.map(r => r.posicion).filter(v => v != null).map(Number);
        const result = analizaPosiciones(posiciones);
        return successResponse(res, {
          colaborador: where.idColaborador, examenId, names: null, lastNames: null, area: null,
          ...result, muestraPosiciones: posiciones.slice(0, 10)
        }, `Análisis de posiciones por idExamen (${examenId}) e idColaborador (${where.idColaborador}).`);
      }

      const porColab = new Map();
      for (const r of rows) {
        const c = r.idColaborador ?? null;
        if (!c) continue;
        if (!porColab.has(c)) porColab.set(c, []);
        if (r.posicion != null) porColab.get(c).push(Number(r.posicion));
      }

      const detalles = [];
      const siempreIds = [], mayormenteIds = [];
      for (const [idc, posiciones] of porColab) {
        const a = analizaPosiciones(posiciones);
        detalles.push({ idColaborador: idc, ...a });
        if (a.usaSiempreMismaPosicion) siempreIds.push(idc);
        if (a.usaMayormenteMismaPosicion) mayormenteIds.push(idc);
      }

      return successResponse(res, {
        examenId, totalColaboradoresAnalizados: detalles.length,
        anyUsaSiempreMismaPosicion: siempreIds.length > 0,
        anyUsaMayormenteMismaPosicion: mayormenteIds.length > 0,
        colaboradoresUsaSiempreMismaPosicion: siempreIds.map(id => ({ idColaborador: id })),
        colaboradoresUsaMayormenteMismaPosicion: mayormenteIds.map(id => ({ idColaborador: id })),
        detallesPorColaborador: detalles,
      }, `Análisis de posiciones por examen (${examenId}).`);
    } catch (error) {
      console.error('Error en análisis de posiciones:', error);
      return errorResponse(res, 'Error interno del servidor al analizar posiciones');
    }
  }

  static async getAnalisisPosicionesByExamenColaboradorV2(req, res) {
    try {
      const examenId = toInt(req.params.idExamen);
      if (examenId == null) return errorResponse(res, 'idExamen debe ser numérico', 400);
      const where = { idExamen: examenId };
      let colab = req.params.idColaborador ?? req.query.idColaborador;
      if (colab !== undefined) {
        colab = String(colab).trim();
        if (!colab) return errorResponse(res, 'idColaborador no puede estar vacío', 400);
        where.idColaborador = colab;
      }

      const rows = await prisma.evaluacionesRespuestas.findMany({
        where,
        select: { idColaborador: true, posicion: true },
        orderBy: [{ idColaborador: 'asc' }, { id: 'asc' }]
      });

      if (!rows.length) {
        const detalle = where.idColaborador ? `para el examen ${examenId} y el colaborador ${where.idColaborador}` : `para el examen ${examenId}`;
        return successResponse(res, [], `Aún no hay respuestas registradas ${detalle}.`);
      }

      const analizaPosiciones = (posiciones) => {
        const total = posiciones.length;
        if (!total) return { totalRespuestas: 0, posicionesUnicas: 0, posicionMasFrecuente: null, porcentajeMasFrecuente: 0, usaSiempreMismaPosicion: false, usaMayormenteMismaPosicion: false, distribucion: [] };
        const conteo = new Map();
        for (const p of posiciones) { if (p != null) conteo.set(p, (conteo.get(p) || 0) + 1); }
        const distribucion = Array.from(conteo.entries()).sort((a, b) => b[1] - a[1]).map(([pos, count]) => ({ posicion: pos, conteo: count, porcentaje: Math.round((count / total) * 1000) / 10 }));
        const unicas = conteo.size;
        const mf = distribucion[0] || { posicion: null, conteo: 0, porcentaje: 0 };
        return { totalRespuestas: total, posicionesUnicas: unicas, posicionMasFrecuente: mf.posicion, porcentajeMasFrecuente: mf.porcentaje, usaSiempreMismaPosicion: unicas === 1, usaMayormenteMismaPosicion: mf.porcentaje >= 80, distribucion };
      };

      if (where.idColaborador) {
        const posiciones = rows.map(r => r.posicion).filter(v => v != null).map(Number);
        const result = analizaPosiciones(posiciones);
        return successResponse(res, {
          colaborador: where.idColaborador, examenId, nombreCompleto: null, correo: null, area: null,
          ...result, muestraPosiciones: posiciones.slice(0, 10)
        }, `Análisis de posiciones por idExamen (${examenId}) e idColaborador (${where.idColaborador}).`);
      }

      const porColab = new Map();
      for (const r of rows) {
        const c = r.idColaborador ?? null;
        if (!c) continue;
        if (!porColab.has(c)) porColab.set(c, []);
        if (r.posicion != null) porColab.get(c).push(Number(r.posicion));
      }

      const detalles = [];
      const siempreIds = [], mayormenteIds = [];
      for (const [idc, posiciones] of porColab) {
        const a = analizaPosiciones(posiciones);
        detalles.push({ idColaborador: idc, nombreCompleto: null, correo: null, ...a });
        if (a.usaSiempreMismaPosicion) siempreIds.push(idc);
        if (a.usaMayormenteMismaPosicion) mayormenteIds.push(idc);
      }

      return successResponse(res, {
        examenId, totalColaboradoresAnalizados: detalles.length,
        anyUsaSiempreMismaPosicion: siempreIds.length > 0,
        anyUsaMayormenteMismaPosicion: mayormenteIds.length > 0,
        colaboradoresUsaSiempreMismaPosicion: siempreIds.map(id => ({ idColaborador: id, nombreCompleto: null, correo: null, area: null })),
        colaboradoresUsaMayormenteMismaPosicion: mayormenteIds.map(id => ({ idColaborador: id, nombreCompleto: null, correo: null, area: null })),
        detallesPorColaborador: detalles,
      }, `Análisis de posiciones por examen (${examenId}) con nombre completo y correo.`);
    } catch (error) {
      console.error('Error en análisis de posiciones (v2):', error);
      return errorResponse(res, 'Error interno del servidor al analizar posiciones');
    }
  }

  // ============================================================================
  // AZURE OPENAI - Calificar ejercicio
  // ============================================================================

  static async calificarEjercicio(req, res) {
    try {
      const { prompt, ejercicio } = req.body;
      if (!prompt || !ejercicio) {
        return errorResponse(res, 'Los campos prompt y ejercicio son obligatorios', 400);
      }
      const puntuacion = await callAzureOpenAI(String(prompt), String(ejercicio));
      return successResponse(res, puntuacion, 'Ejercicio calificado exitosamente');
    } catch (error) {
      console.error('Error al calificar ejercicio (Azure):', error);
      return errorResponse(res, 'Error interno del servidor al calificar el ejercicio: ' + error.message);
    }
  }

  // ============================================================================
  // AZURE OPENAI - Recomendaciones por área (simplificada)
  // ============================================================================

  static async getRecomendacionesPorArea(req, res) {
    const Respuestas = prisma.evaluacionesRespuestas;
    const Resultados = prisma.evaluacionesResultadosPorExamen;
    const Ranking = prisma.evaluacionesRanking;
    const Preguntas = prisma.evaluacionesPreguntas;

    try {
      const toInt2 = (v) => (v == null || v === '') ? null : parseInt(v, 10);
      const round1 = (n) => Math.round(n * 10) / 10;
      const percent = (a, b) => (b > 0 ? round1((a / b) * 100) : 0);
      const safeStr = (s) => (s == null ? '' : String(s));

      const areaParam = safeStr(req.params.area).trim();
      if (!areaParam) return errorResponse(res, 'El parámetro :area es obligatorio', 400);
      const examenId = req.query.examenId != null ? toInt2(req.query.examenId) : null;

      const whereResultados = {};
      if (examenId != null) whereResultados.idExamen = examenId;
      const todosResultados = await Resultados.findMany({ where: whereResultados });
      if (!todosResultados.length) {
        return successResponse(res, null, `No hay resultados registrados.`);
      }

      const respondedores = new Set(todosResultados.map(r => r.idColaborador));
      const totalColab = respondedores.size;
      const tasaRespuesta = 100;

      const puntosPorColab = {};
      for (const r of todosResultados) {
        puntosPorColab[r.idColaborador] = (puntosPorColab[r.idColaborador] ?? 0) + Number(r.calificacion ?? 0);
      }
      const promedioPuntos = Object.keys(puntosPorColab).length
        ? round1(Object.values(puntosPorColab).reduce((a, b) => a + b, 0) / Object.keys(puntosPorColab).length)
        : 0;

      const rangos = { Explorador: 0, Pionero: 0, Adoptador: 0, Integrador: 0 };
      for (const r of todosResultados) {
        const k = safeStr(r.rango).trim();
        if (rangos.hasOwnProperty(k)) rangos[k]++;
      }

      const wherePreg = examenId != null ? { idExamen: examenId } : {};
      const nivelesRows = await Preguntas.findMany({
        where: wherePreg,
        select: { nivel: true },
        distinct: ['nivel']
      });
      const niveles = nivelesRows.map(r => r.nivel).filter(Boolean);

      const whereResp = examenId != null ? { idExamen: examenId } : {};
      const todasResp = await Respuestas.findMany({ where: whereResp });

      const nivelesData = [];
      for (const nivel of niveles) {
        const whereNivel = examenId != null ? { idExamen: examenId, nivel } : { nivel };
        const maxPosible = (await Preguntas.aggregate({ _sum: { puntosMaximos: true }, where: whereNivel }))._sum.puntosMaximos || 0;

        const puntosNivelPorColab = {};
        for (const r of todasResp.filter(x => safeStr(x.nivel).trim() === safeStr(nivel).trim())) {
          puntosNivelPorColab[r.idColaborador] = (puntosNivelPorColab[r.idColaborador] ?? 0) + Number(r.puntos ?? 0);
        }
        const vals = Object.values(puntosNivelPorColab);
        const avg = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
        const porcentaje = maxPosible > 0 ? round1((avg / maxPosible) * 100) : null;
        nivelesData.push({ nivel, maxPosible, avgPuntos: round1(avg), porcentaje });
      }

      const nivelesOrdenados = nivelesData.filter(n => n.porcentaje != null).sort((a, b) => a.porcentaje - b.porcentaje);
      const brechasPrincipales = nivelesOrdenados.slice(0, 2).map(n => n.nivel);

      const rendimiento = {
        tasaRespuesta,
        promedioPuntosPorColaborador: promedioPuntos,
        niveles: nivelesData.reduce((acc, n) => { acc[safeStr(n.nivel).toUpperCase()] = n.porcentaje; return acc; }, {}),
        rangos
      };

      const openAiInput = {
        area: areaParam,
        firma: 'v1.2-kb',
        fortalecerNiveles: brechasPrincipales,
        conocimientosObjetivo: (() => {
          const list = [];
          for (const n of brechasPrincipales) {
            const kb = KNOWLEDGE_BASE[safeStr(n).toUpperCase()];
            (kb?.conocimientos || []).forEach(x => { if (!list.includes(x)) list.push(x); });
          }
          return list;
        })(),
        rendimiento
      };

      const aiRec = await callAzureOpenAIRecomendacionesAreaV4(openAiInput);
      const { analisisAI, cursosAI } = validateAndNormalizeOpenAIResponse(aiRec);

      const cleanseObjective = (txt) => {
        if (!txt) return '';
        let s = String(txt);
        s = s.replace(/(?:\+?\s?\d+(?:[.,]\d+)?\s*%)/gi, '');
        s = s.replace(/(?:\+?\s?\d+(?:[.,]\d+)?\s*(?:pts?|puntos?))/gi, '');
        s = s.replace(/\s{2,}/g, ' ').trim();
        s = s.replace(/\breduciendo en\b/gi, 'reduciendo');
        s = s.replace(/\baumentando en\b/gi, 'aumentando');
        s = s.replace(/\bmejorando en\b/gi, 'mejorando');
        if (s.length < 10) s = 'Lograr mejoras verificables en el resultado definido.';
        return s;
      };

      const softenAnalysis = (txt) => {
        if (!txt) return 'Gracias por su participación. Vemos una base sólida y oportunidades claras para seguir creciendo.';
        let s = String(txt);
        s = s.replace(/\bbrecha(s)? crítica(s)?\b/gi, 'oportunidad(es) importante(s) de mejora');
        s = s.replace(/\bbrecha(s)?\b/gi, 'oportunidad(es) de mejora');
        s = s.replace(/\bgap(s)?\b/gi, 'oportunidad(es) de mejora');
        s = s.replace(/\bnulo(s)?\b/gi, 'aún por desarrollar');
        s = s.replace(/\bpor debajo del umbral\b/gi, 'con margen de crecimiento');
        s = s.replace(/\binsuficiente\b/gi, 'con margen de mejora');
        if (!/próximo(s)? paso(s)?|siguiente(s)? paso(s)?|enfoquémonos|seguimiento/i.test(s)) {
          s += ' Enfoquémonos en pasos concretos y realistas para capitalizar lo que ya está funcionando y avanzar al siguiente nivel.';
        }
        return s.trim();
      };

      const cursosBaseProcesados = (Array.isArray(cursosAI.base) ? cursosAI.base : []).map(c => ({
        ...c, objetivo: cleanseObjective(c?.objetivo || '')
      }));
      let cursoEspecificoProcesado = null;
      if (cursosAI.especificoArea) {
        cursoEspecificoProcesado = {
          ...cursosAI.especificoArea,
          objetivo: cleanseObjective(cursosAI.especificoArea?.objetivo || '')
        };
      }
      const mensajeAmable = softenAnalysis(analisisAI?.diagnostico);

      const puntosClave = [];
      if (brechasPrincipales.length) puntosClave.push(`Oportunidad principal: reforzar ${brechasPrincipales.join(' y ')}.`);
      puntosClave.push(`Participación: ${respondedores.size}/${totalColab} (${tasaRespuesta}%).`);
      puntosClave.push(`Promedio por colaborador: ${promedioPuntos}.`);

      const conocimientosBase = Object.keys(KNOWLEDGE_BASE).reduce((acc, key) => {
        const kb = KNOWLEDGE_BASE[key] || {};
        acc[key] = { descripcion: kb.descripcion, conocimientos: Array.isArray(kb.conocimientos) ? kb.conocimientos : [] };
        return acc;
      }, {});

      const response = {
        area: areaParam,
        examenId: examenId ?? null,
        resumen: {
          colaboradores: { total: totalColab, respondieron: respondedores.size, tasaRespuesta },
          performance: { promedioPuntosPorColaborador: promedioPuntos, rangos, niveles: nivelesData }
        },
        analisis: { tono: 'constructivo', mensaje: mensajeAmable, puntosClave },
        conocimientosBase,
        recomendacion: {
          fortalecerNiveles: brechasPrincipales,
          conocimientosObjetivo: openAiInput.conocimientosObjetivo,
          cursos: { base: cursosBaseProcesados, especificoArea: cursoEspecificoProcesado }
        },
        libreriaVersion: 'v1.2-kb'
      };

      return successResponse(res, response, `Recomendaciones generadas para el área "${areaParam}"${examenId != null ? ` (examen ${examenId})` : ''}.`);
    } catch (error) {
      console.error('Error en getRecomendacionesPorArea:', error);
      return errorResponse(res, 'Error interno del servidor al generar recomendaciones por área');
    }
  }

  // ============================================================================
  // BULK IMPORT (JSON)
  // ============================================================================
  static async bulkImport(req, res) {
    try {
      const tableName = req.params.table;
      const rows = req.body;
      if (!Array.isArray(rows) || !rows.length) {
        return errorResponse(res, 'El body debe ser un array no vacío de objetos.', 400);
      }
      const result = await bulkImport(tableName, rows);
      return successResponse(res, result, `${result.inserted} registros importados en ${tableName}.`);
    } catch (error) {
      console.error('Error en bulk import:', error);
      return errorResponse(res, error.message, 500);
    }
  }
}
