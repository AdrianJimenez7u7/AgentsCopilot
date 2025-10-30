// Servicio para manejar el almacenamiento temporal de candidatos
export class CandidatesService {
  static sessions = new Map();
  static SESSION_TTL = 30 * 60 * 1000; // 30 minutos en ms

  // Guarda los candidatos y devuelve un sessionId
  static storeCandidates(candidates, solicitud, tokens = null) {
    const sessionId = Date.now().toString(36) + Math.random().toString(36).substring(2);
    const session = {
      candidates,
      solicitud,
      tokens,
      timestamp: Date.now()
    };
    this.sessions.set(sessionId, session);
    this.cleanOldSessions();
    return sessionId;
  }

  // Recupera los candidatos para un sessionId
  static getCandidates(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    
    // Verificar si la sesión expiró
    if (Date.now() - session.timestamp > this.SESSION_TTL) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  // Limpia sesiones antiguas
  static cleanOldSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.timestamp > this.SESSION_TTL) {
        this.sessions.delete(sessionId);
      }
    }
  }
}