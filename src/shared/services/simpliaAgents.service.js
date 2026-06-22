
export class SimpliaAgentsService {

    // Identidad de sistema para autenticar la API key (igual que en evaluaciones).
    static _SYSTEM_EMAIL = 'transformacion.digital@compucad.com.mx';

    // Caché en memoria del mapa correo -> unidad de negocio (se reconstruye al reiniciar).
    static _unidadNegocioMapCache = null;

    /**
     * Trae TODOS los usuarios de Simplia en una sola petición (auth/users).
     * @returns {Promise<Array>} arreglo de colaboradores ({ Correo, Area: { Nombre }, ... })
     */
    static async getAllUsers() {
        const response = await fetch(`${process.env.SIMPLIA_AGENTS_BACKEND}auth/users`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.SIMPLIA_AGENTS_BACKEND_API_KEY,
                'x-user-email': this._SYSTEM_EMAIL
            }
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error al obtener usuarios de Simplia Agents: ${response.status} - ${errorText}`);
        }
        const json = await response.json();
        return Array.isArray(json) ? json : (json?.users ?? json?.colaboradores ?? []);
    }

    /**
     * Mapa correo (en minúsculas) -> unidad de negocio (Area.Nombre), cacheado.
     * Una sola llamada a auth/users sirve para todas las guías de un batch.
     * @param {{force?: boolean}} [opts] - force:true reconstruye el caché
     * @returns {Promise<Map<string, string|null>>}
     */
    static async getUnidadNegocioPorCorreoMap({ force = false } = {}) {
        if (this._unidadNegocioMapCache && !force) return this._unidadNegocioMapCache;

        const users = await this.getAllUsers();
        const map = new Map();
        for (const u of users) {
            if (u?.Correo) map.set(u.Correo.toLowerCase(), u.Area?.Nombre ?? null);
        }
        this._unidadNegocioMapCache = map;
        return map;
    }

    static async searchUser(email){
        try {
        const response = await fetch(`${process.env.SIMPLIA_AGENTS_BACKEND}auth/user`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.SIMPLIA_AGENTS_BACKEND_API_KEY,
                'x-user-email': email
            },
            body: JSON.stringify({ email: email })
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Error al buscar usuario en Simplia Agents: ${response.status} - ${errorText}`);
            throw new Error(`Error al buscar usuario en Simplia Agents: ${response.status} - ${errorText}`);
        }
        return response.json();
        } catch (error) {
            console.error("Error al buscar usuario en Simplia Agents:", error);
            throw new Error("Error al buscar usuario en Simplia Agents: " + (error?.message ?? String(error)));
        }
    }
}