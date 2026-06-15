import { Router, json } from 'express';
import { EvaluacionesController } from '../controllers/evaluaciones.controller.js';

const router = Router();

// ============================================================================
// EXAMENES
// ============================================================================
router.get('/examen', EvaluacionesController.getAllExamenes);
router.get('/examenes', EvaluacionesController.getAllExamenes);
router.post('/examenes', EvaluacionesController.createExamen);
router.get('/examenes/colaborador/:idColaborador', EvaluacionesController.getExamenesRealizadosPorColaborador);
router.get('/examenes/:id', EvaluacionesController.getExamenById);
router.put('/examenes/:id', EvaluacionesController.updateExamen);
router.delete('/examenes/:id', EvaluacionesController.deleteExamen);

// ============================================================================
// PREGUNTAS
// ============================================================================
router.get('/preguntas', EvaluacionesController.getAllPreguntas);
router.post('/preguntas', EvaluacionesController.createPregunta);
router.post('/preguntas/bulk', EvaluacionesController.bulkCreatePreguntas);
router.delete('/preguntas', EvaluacionesController.deleteAllPreguntas);
router.get('/preguntas/:id', EvaluacionesController.getPreguntaById);
router.put('/preguntas/:id', EvaluacionesController.updatePregunta);
router.delete('/preguntas/:id', EvaluacionesController.deletePregunta);

// ============================================================================
// PREGUNTAS CON INCISOS
// ============================================================================
router.get('/preguntas-incisos/by-examen/:idExamen', EvaluacionesController.getPreguntaConIncisosByIdExamen);
router.get('/preguntas/examen/:idExamen', EvaluacionesController.getPreguntaConIncisosByIdExamen);

// ============================================================================
// INCISOS
// ============================================================================
router.get('/incisos', EvaluacionesController.getAllIncisos);
router.post('/incisos', EvaluacionesController.createInciso);
router.post('/incisos/bulk', EvaluacionesController.bulkCreateIncisos);
router.put('/incisos/assign-exam', EvaluacionesController.bulkAssignExamToIncisos);
router.delete('/incisos', EvaluacionesController.deleteAllIncisos);
router.get('/incisos/:idExamen/:idPregunta/:letra', EvaluacionesController.getInciso);
router.put('/incisos/:idExamen/:idPregunta/:letra', EvaluacionesController.updateInciso);
router.delete('/incisos/:idExamen/:idPregunta/:letra', EvaluacionesController.deleteInciso);

// ============================================================================
// RESPUESTAS
// ============================================================================
router.get('/respuestas', EvaluacionesController.getAllRespuestas);
router.post('/respuestas', EvaluacionesController.createRespuesta);
router.post('/respuestas/bulk', EvaluacionesController.bulkCreateRespuestas);
router.delete('/respuestas', EvaluacionesController.deleteAllRespuestas);
router.get('/respuestas/:id', EvaluacionesController.getRespuestaById);
router.put('/respuestas/:id', EvaluacionesController.updateRespuesta);
router.delete('/respuestas/:id', EvaluacionesController.deleteRespuesta);
router.get('/respuestas/examen/:idExamen', EvaluacionesController.getRespuestasByExamen);
router.get('/respuestas/examen/:idExamen/colaborador/:idColaborador', EvaluacionesController.getRespuestasByExamenColaborador);
router.get('/respuestas/colaborador/:idColaborador', EvaluacionesController.getRespuestasByColaborador);

// ============================================================================
// RANKING
// ============================================================================
router.get('/rankings', EvaluacionesController.getAllRankings);
router.post('/ranking-por-examen/bulk', EvaluacionesController.bulkCargarRankingPorExamen);
router.put('/rankings/:id', EvaluacionesController.updateRanking);
router.delete('/rankings/:id', EvaluacionesController.deleteRanking);
router.get('/rankings/:id', EvaluacionesController.getRankingById);
router.get('/rankings-por-examen/:idExamen', EvaluacionesController.getRankingsPorExamen);

// ============================================================================
// RESULTADOS
// ============================================================================
router.get('/resultados', EvaluacionesController.getAllResultados);
router.get('/resultados/:id', EvaluacionesController.getResultadoById);
router.put('/resultados/:id', EvaluacionesController.updateResultado);
router.delete('/resultados/:id', EvaluacionesController.deleteResultado);
router.get('/resultados/examen/:idExamen', EvaluacionesController.getResultadosByExamen);
router.get('/resultados/colaborador/:idColaborador', EvaluacionesController.getResultadosByColaborador);
router.get('/resultados/examen/:idExamen/colaborador/:idColaborador', EvaluacionesController.getResultadosByExamenYColaborador);

// ============================================================================
// ANALYTICS
// ============================================================================
router.get('/analisis-preguntas/examen/:idExamen', EvaluacionesController.getAnalisisPorPreguntaByExamen);
router.get('/analisis-posiciones/examen/:idExamen', EvaluacionesController.getAnalisisPosicionesByExamenColaborador);
router.get('/respuestas/analisis-posiciones/examen/:idExamen', EvaluacionesController.getAnalisisPosicionesByExamenColaborador);
router.get('/analisis-posiciones-v2/examen/:idExamen', EvaluacionesController.getAnalisisPosicionesByExamenColaboradorV2);
router.get('/respuestas/analisis-posiciones-v2/examen/:idExamen', EvaluacionesController.getAnalisisPosicionesByExamenColaboradorV2);
router.get('/preguntas-no-contestadas/examen/:idExamen', EvaluacionesController.getPreguntasNoContestadasPorExamen);
router.get('/examenes/:idExamen/faltantes', EvaluacionesController.getFaltantesPorResponder);
router.get('/resultados/resumen/areas', EvaluacionesController.getResumenPorAreas);
router.get('/resultados/resumen/areas/:area', EvaluacionesController.getResumenPorArea);
router.get('/examenes/:idExamen/resumen-areas', EvaluacionesController.getResumenRespuestasPorArea);
router.get('/examenes/:idExamen/respondieron', EvaluacionesController.getRespondieronExamen);
router.get('/examenes/:idExamen/resumen', EvaluacionesController.getResumenExamen);

// ============================================================================
// CSV IMPORT
// ============================================================================
router.post('/import/:table', json({ limit: '50mb' }), EvaluacionesController.bulkImport);

// ============================================================================
// AZURE OPENAI
// ============================================================================
router.post('/calificar-ejercicio', EvaluacionesController.calificarEjercicio);
router.get('/recomendaciones/area/:area', EvaluacionesController.getRecomendacionesPorArea);
router.get('/areas/:area/recomendaciones', EvaluacionesController.getRecomendacionesPorArea);


router.get('/colaborador', EvaluacionesController.getColaborador);
router.get('/colaborador/simplia/:correo', EvaluacionesController.getColaboradorByCorreo);

export default router;
