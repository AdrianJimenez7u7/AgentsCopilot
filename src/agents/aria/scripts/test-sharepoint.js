import axios from 'axios';
import { URLSearchParams } from 'url';

// CONFIGURACIÓN (Extraída de tu código actual)
const TENANT_ID = "267e7400-d5af-4805-bce9-1e4247c0c3a7";
const CLIENT_ID = "6840a6b2-7154-4c5d-8081-003edd0da715";
const CLIENT_SECRET = process.env.DYNAMIC_SECRET;

const SITE_HOSTNAME = "compucad1.sharepoint.com";
const SITE_PATH = "/sites/ccad";

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
        const siteRes = await axios.get(`https://graph.microsoft.com/v1.0/sites/${SITE_HOSTNAME}:${SITE_PATH}`, {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const siteData = siteRes.data;
        const drivesRes = await axios.get(`https://graph.microsoft.com/v1.0/sites/${siteData.id}/drives`, {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const drivesData = drivesRes.data;
        drivesData.value.forEach(d => {
        });

        // 4. Buscar carpeta Aria dentro del Drive 'Documentos'
        // Asumimos que el drive principal se llama "Documentos" o similar
        const documentsDrive = drivesData.value.find(d => d.name === "Documentos" || d.name === "Documents" || d.webUrl.includes("Shared Documents"));

        if (documentsDrive) {

            try {
                const folderRes = await axios.get(`https://graph.microsoft.com/v1.0/drives/${documentsDrive.id}/root:/Agentes/Aria`, {
                    headers: { Authorization: `Bearer ${access_token}` }
                });
            } catch (e) {
            }
        } else {
        }

    } catch (error) {
        if (error.response) {
            console.error("❌ Error API:", error.response.status, error.response.data);
        } else {
            console.error("❌ Error General:", error.message);
        }
    }
}

main();
