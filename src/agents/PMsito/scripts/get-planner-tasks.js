import axios from 'axios';
import { URLSearchParams } from 'url';
import 'dotenv/config';

// Credenciales
const TENANT_ID = "267e7400-d5af-4805-bce9-1e4247c0c3a7";
const CLIENT_ID = "6840a6b2-7154-4c5d-8081-003edd0da715";
const CLIENT_SECRET = process.env.DYNAMIC_SECRET;

const DATAVERSE_URL = "https://orgf61000bc.api.crm.dynamics.com";

async function main() {
    try {
        console.log("--- INICIANDO SCRIPT ---");
        if (!CLIENT_SECRET) {
            throw new Error("DYNAMIC_SECRET no está definida en las variables de entorno.");
        }

        console.log("1. Autenticando con Dataverse...");

        const tokenParams = new URLSearchParams();
        tokenParams.append('client_id', CLIENT_ID);
        tokenParams.append('scope', `${DATAVERSE_URL}/.default`);
        tokenParams.append('client_secret', CLIENT_SECRET);
        tokenParams.append('grant_type', 'client_credentials');

        const tokenRes = await axios.post(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, tokenParams.toString());
        const { access_token } = tokenRes.data;

        // 2. Consultar proyectos (Top 50 para asegurar que encontramos el que buscamos)
        console.log("\n2. Consultando Proyectos (Top 50)...");
        const projectsUrl = `${DATAVERSE_URL}/api/data/v9.2/msdyn_projects?$select=msdyn_projectid,msdyn_subject&$top=50`;

        const projectsRes = await axios.get(projectsUrl, {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const projects = projectsRes.data.value;
        console.log(`--- Encontrados ${projects.length} proyectos ---`);

        // Buscando el proyecto específico en memoria (más seguro que OData filter si hay caracteres raros)
        const targetNamePart = "BayWa";
        const targetProject = projects.find(p => p.msdyn_subject && p.msdyn_subject.includes(targetNamePart));

        if (targetProject) {
            console.log(`✅ PROYECTO ENCONTRADO: "${targetProject.msdyn_subject}" (ID: ${targetProject.msdyn_projectid})`);

            // 4. Obtener Tareas
            console.log(`\n4. Obteniendo tareas para este proyecto...`);
            const tasksUrl = `${DATAVERSE_URL}/api/data/v9.2/msdyn_projecttasks?$filter=_msdyn_project_value eq ${targetProject.msdyn_projectid}&$select=msdyn_subject,msdyn_start,msdyn_finish&$top=20`;

            const tasksRes = await axios.get(tasksUrl, {
                headers: {
                    Authorization: `Bearer ${access_token}`,
                    "Prefer": "odata.include-annotations=\"*\""
                }
            });

            const tasks = tasksRes.data.value;
            console.log(`--- Tareas (${tasks.length}) ---`);
            tasks.forEach(t => {
                console.log(`- [${t.msdyn_subject}] Inicio: ${t.msdyn_start || 'N/A'} | Fin: ${t.msdyn_finish || 'N/A'}`);
            });

        } else {
            console.log(`❌ No se encontró ningún proyecto que contenga "${targetNamePart}" en los últimos 50.`);
            console.log("Listado de proyectos encontrados:");
            projects.forEach(p => console.log(`  - ${p.msdyn_subject}`));
        }


    } catch (error) {
        if (error.response) {
            console.error("ERROR API:", error.response.status, error.response.statusText);
            console.error("Detalle:", JSON.stringify(error.response.data, null, 2));
        } else {
            console.error("ERROR:", error.message);
        }
    }
}

main();
