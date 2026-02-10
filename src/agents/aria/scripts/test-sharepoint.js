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
        console.log("1. Obteniendo Token de Acceso (Graph API)...");
        const tokenParams = new URLSearchParams();
        tokenParams.append('client_id', CLIENT_ID);
        tokenParams.append('scope', 'https://graph.microsoft.com/.default');
        tokenParams.append('client_secret', CLIENT_SECRET);
        tokenParams.append('grant_type', 'client_credentials');

        const tokenRes = await axios.post(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, tokenParams.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const { access_token } = tokenRes.data;
        console.log("✅ Token obtenido.");

        console.log(`2. Buscando Site ID para: ${SITE_HOSTNAME}:${SITE_PATH}...`);
        const siteRes = await axios.get(`https://graph.microsoft.com/v1.0/sites/${SITE_HOSTNAME}:${SITE_PATH}`, {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const siteData = siteRes.data;
        console.log(`✅ Site ID: ${siteData.id}`);

        console.log("3. Listando Drives (Bibliotecas de Documentos)...");
        const drivesRes = await axios.get(`https://graph.microsoft.com/v1.0/sites/${siteData.id}/drives`, {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const drivesData = drivesRes.data;

        console.log("--- DRIVES ENCONTRADOS ---");
        drivesData.value.forEach(d => {
            console.log(`Name: ${d.name} | URL: ${d.webUrl} | ID: ${d.id}`);
        });

        // 4. Buscar carpeta Aria dentro del Drive 'Documentos'
        // Asumimos que el drive principal se llama "Documentos" o similar
        const documentsDrive = drivesData.value.find(d => d.name === "Documentos" || d.name === "Documents" || d.webUrl.includes("Shared Documents"));

        if (documentsDrive) {
            console.log(`\n📂 Drive seleccionado: ${documentsDrive.name} (${documentsDrive.id})`);
            console.log(`4. Verificando ruta /Agentes/Aria...`);

            try {
                const folderRes = await axios.get(`https://graph.microsoft.com/v1.0/drives/${documentsDrive.id}/root:/Agentes/Aria`, {
                    headers: { Authorization: `Bearer ${access_token}` }
                });
                console.log(`✅ Carpeta encontrada: ${folderRes.data.webUrl}`);
            } catch (e) {
                console.log(`⚠️ Carpeta /Agentes/Aria no encontrada (se creará al subir).`);
            }
        } else {
            console.log("⚠️ No se encontró la biblioteca 'Documentos' estándar automáticamente.");
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
