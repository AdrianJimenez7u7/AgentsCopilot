
export class SimpliaAgentsService {

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