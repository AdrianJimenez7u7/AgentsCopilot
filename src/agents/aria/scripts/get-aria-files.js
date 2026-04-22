import axios from 'axios';
import { URLSearchParams } from 'url';

// CONFIGURACIÓN (TD)
const TENANT_ID = "267e7400-d5af-4805-bce9-1e4247c0c3a7";
const CLIENT_ID = "6840a6b2-7154-4c5d-8081-003edd0da715";
const CLIENT_SECRET = process.env.DYNAMIC_SECRET;

const DRIVE_ID = "b!bSuHMmR-nUmBip_FT67_ODpp-ZUHAWZFq91jHGiCJADUKY-CuWOtQ5coNu0a6zDL"; // TD -> Documentos
const FOLDER_PATH = "/Agentes/Aria";

async function main() {
    try {
        const tokenParams = new URLSearchParams();
        tokenParams.append('client_id', CLIENT_ID);
        tokenParams.append('scope', 'https://graph.microsoft.com/.default');
        tokenParams.append('client_secret', CLIENT_SECRET);
        tokenParams.append('grant_type', 'client_credentials');

        const tokenRes = await axios.post(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, tokenParams.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const { access_token } = tokenRes.data;
        // Listar hijos de la carpeta
        const url = `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/root:${FOLDER_PATH}:/children`;

        const listRes = await axios.get(url, {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const files = listRes.data.value;
        files.forEach(f => {
        });

    } catch (error) {
        if (error.response) {
            console.error("❌ Error API:", error.response.status, error.response.data);
        } else {
            console.error("❌ Error General:", error.message);
        }
    }
}

main();
