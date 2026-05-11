export class DataverseService {
    constructor() {
        this.tenantId = process.env.AZURE_TENANT_ID;
        this.clientId = "6840a6b2-7154-4c5d-8081-003edd0da715";
        this.clientSecret = process.env.DYNAMIC_SECRET;
        this.webApiUrl = process.env.DATAVERSE_WEB_API_URL || "https://ccad.api.crm.dynamics.com/api/data/v9.2";
        this.scope = `${new URL(this.webApiUrl).origin}/.default`;
        this.secret = process.env.DATAVERSE_SECRET;
    }

    async getAccessToken() {
        const response = await fetch(`https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                scope: this.scope,
                grant_type: 'client_credentials'
            })
        });
        if (!response.ok) {
            throw new Error(`Error obteniendo token: ${response.statusText}`);
        }
        const data = await response.json();
        return data.access_token;
    }

    async getAccessTokenForUpgrade() {
        const upgradeWebApiUrl = process.env.DATAVERSE_UPGRADE_WEB_API_URL || "https://orgf61000bc.api.crm.dynamics.com/api/data/v9.2";
        const upgradeScope = `${new URL(upgradeWebApiUrl).origin}/.default`;
        const response = await fetch(`https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                scope: upgradeScope,
                grant_type: 'client_credentials'
            })
        });
        if (!response.ok) {
            throw new Error(`Error obteniendo token upgrade: ${response.statusText}`);
        }
        const data = await response.json();
        return data.access_token;
    }

    async getChoiceValueByLabel(entityLogicalName, attributeLogicalName, targetLabel) {
        const token = await this.getAccessToken();
        const metadataResponse = await fetch(
            `${this.webApiUrl}/EntityDefinitions(LogicalName='${entityLogicalName}')/Attributes(LogicalName='${attributeLogicalName}')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options),GlobalOptionSet($select=Options)`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            }
        );

        if (!metadataResponse.ok) {
            throw new Error(`Error obteniendo metadatos de ${attributeLogicalName}: ${metadataResponse.statusText}`);
        }

        const metadata = await metadataResponse.json();
        const options = [
            ...(metadata?.OptionSet?.Options || []),
            ...(metadata?.GlobalOptionSet?.Options || []),
        ];

        const matchedOption = options.find(option => {
            const localizedLabels = option?.Label?.LocalizedLabels || [];
            return option?.Label?.UserLocalizedLabel?.Label === targetLabel || localizedLabels.some(label => label?.Label === targetLabel);
        });

        if (matchedOption == null) {
            throw new Error(`No se encontró la opción ${targetLabel} en ${attributeLogicalName}`);
        }

        return matchedOption.Value;
    }

    async getCasosCRM() {
        const token = await this.getAccessToken();
        const areaServicioValue = await this.getChoiceValueByLabel("incident", "cad_area_servicio", "PMO");
        const parameters = new URLSearchParams({
            "$select": "incidentid,title,createdon,statuscode,cad_area_servicio,_cr2bd_clientev2_value",
            //"$filter": `cad_area_servicio eq ${areaServicioValue}`
        });
        const response = await fetch(`${this.webApiUrl}/incidents?${parameters.toString()}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"',
            },
        });
        if (!response.ok) {
            throw new Error(`Error fetching casos CRM: ${response.status} ${response.statusText} - ${await response.text()}`);
        }
        return response.json();
    }
    
    async getComentariosCaso(casoId) {
        const token = await this.getAccessToken();

        const params = new URLSearchParams();
        params.set("$select", "annotationid,notetext,subject,createdon,_objectid_value,_createdby_value");
        params.set("$expand", "createdby($select=fullname,internalemailaddress)");
        // ✅ Filtro descomentado y correcto
        params.set("$filter", `objecttypecode eq 'incident' and _objectid_value eq ${casoId}`);

        const response = await fetch(`${this.webApiUrl}/annotations?${params.toString()}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                "OData-MaxVersion": "4.0",
                "OData-Version": "4.0",
                Accept: "application/json",
                Prefer: 'odata.include-annotations="*"',
            },
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Error fetching comentarios: ${response.status} - ${err}`);
        }

        const data = await response.json();
        return data.value.map(nota => ({
            notaId: nota.annotationid,
            titulo: nota.subject,
            descripcion: nota.notetext?.replace(/<[^>]*>/g, "").trim(),
            creadoEn: nota.createdon,
            autor: nota.createdby?.internalemailaddress
                || nota.createdby?.fullname
                || nota["_createdby_value@OData.Community.Display.V1.FormattedValue"]
                || null,
        }));
    }

    async getCasoPorPlanner(plannerNombre) {
        const token = await this.getAccessToken();

        // Extraer texto dentro de los corchetes: "[Tropper] Seguridad y migración" → "Tropper"
        const dentroCorchetes = plannerNombre.match(/\[([^\]]+)\]/)?.[1] ?? plannerNombre;
        const terminoBusqueda = dentroCorchetes.replace(/'/g, "''");

        console.log('Planner recibido:', plannerNombre);
        console.log('Buscando por término:', terminoBusqueda);

        const url = `${this.webApiUrl}/annotations` +
            `?$select=annotationid,notetext,subject,createdon,_objectid_value` +
            `&$filter=contains(notetext,'${terminoBusqueda}') or contains(subject,'${terminoBusqueda}')` +
            `&$expand=objectid_incident($select=incidentid,ticketnumber,title,statecode)`;

        console.log('URL de consulta:', url);

        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                "OData-MaxVersion": "4.0",
                "OData-Version": "4.0",
                Accept: "application/json",
                Prefer: 'odata.include-annotations="*"',
            },
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`Error: ${response.status} - ${err}`);
        }

        const data = await response.json();

        const casos = data.value.map(nota => ({
            casoId: nota._objectid_value,
            casoNumero: nota.objectid_incident?.ticketnumber,
            casoTitulo: nota.objectid_incident?.title,
            casoEstado: nota.objectid_incident?.statecode,
            casoEstadoLabel: nota.objectid_incident?.["statecode@OData.Community.Display.V1.FormattedValue"],
            notaTitulo: nota.subject,
            descripcion: nota.notetext?.replace(/<[^>]*>/g, "").trim(),
            creadoEn: nota.createdon,
        }));

        const casosConComentarios = await Promise.all(
            casos.map(async caso => ({
                ...caso,
                comentarios: await this.getComentariosCaso(caso.casoId).catch(err => {
                    console.error(`Error comentarios caso ${caso.casoId}:`, err);
                    return [];
                }),
            }))
        );

        return casosConComentarios;
    }

    async getTareasCaso(casoId) {
        const token = await this.getAccessToken();
        const parameters = new URLSearchParams();
        parameters.set("$select", "activityid,subject,description,createdon,statecode,statuscode");
        parameters.set("$expand", "regardingobjectid_incident($select=incidentid,title,ticketnumber)");
        
        if (casoId) {
            parameters.set("$filter", `_regardingobjectid_value eq '${casoId}'`);
        }

        const response = await fetch(`${this.webApiUrl}/tasks?${parameters.toString()}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "OData-MaxVersion": "4.0",
                "OData-Version": "4.0",
                Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"',
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error fetching tareas: ${response.status} - ${errorText}`);
        }

        return response.json();
    }

    async getPlanners() {
        const token = await this.getAccessTokenForUpgrade();
        const upgradeWebApiUrl = "https://orgf61000bc.api.crm.dynamics.com/api/data/v9.2";
        const parameters = new URLSearchParams({
            "$select": "msdyn_projectid,msdyn_subject,createdon,_owningbusinessunit_value",
            "$expand": "owningbusinessunit($select=name)"
            });
        const response = await fetch(`${upgradeWebApiUrl}/msdyn_projects?${parameters.toString()}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error fetching planners: ${response.statusText} - ${errorText}`);
        }
        return response.json();
    }

    async getPlannerAndTasks(plannerName) {
        const token = await this.getAccessTokenForUpgrade();
        const upgradeWebApiUrl = process.env.DATAVERSE_UPGRADE_WEB_API_URL || "https://orgf61000bc.api.crm.dynamics.com/api/data/v9.2";
        const safePlannerName = String(plannerName || '').replace(/'/g, "''");

        const projectParams = new URLSearchParams({
            "$select": "msdyn_projectid,msdyn_subject,createdon",
            "$filter": `msdyn_subject eq '${safePlannerName}'`
        });

        const response = await fetch(`${upgradeWebApiUrl}/msdyn_projects?${projectParams.toString()}`, { 
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },  
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error fetching planner and tasks: ${response.statusText} - ${errorText}`);
        }
        const projectData = await response.json();
        const projects = projectData?.value || [];

        const projectResults = await Promise.all(projects.map(async (proj) => {
            const taskParams = new URLSearchParams({
                "$select": "msdyn_subject,msdyn_start,msdyn_finish,msdyn_progress,msdyn_displaysequence,msdyn_outlinelevel,statuscode,_msdyn_parenttask_value,createdon",
                "$filter": `_msdyn_project_value eq ${proj.msdyn_projectid}`
            });

            const tasksResponse = await fetch(`${upgradeWebApiUrl}/msdyn_projecttasks?${taskParams.toString()}`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                    Prefer: 'odata.include-annotations="*"'
                },
            });

            if (!tasksResponse.ok) {
                const errorText = await tasksResponse.text();
                throw new Error(`Error fetching project tasks: ${tasksResponse.statusText} - ${errorText}`);
            }

            const tasksData = await tasksResponse.json();
            return { ...proj, msdyn_tasks: tasksData?.value || [] };
        }));

        return { value: projectResults };
    }

    /**
     * Obtener todos los datos listos para el reporte de un planner.
     * Llama a getPlannerAndTasks y getCasoPorPlanner y devuelve un objeto
     * { tasks: [...], meta: { plannerName, casos: [...] } }
     */
    async getPlannerReportData(plannerName) {
        try {
            const plannerRes = await this.getPlannerAndTasks(plannerName).catch(err => {
                console.error('Error fetching plannerAndTasks:', err);
                return { value: [] };
            });

            const projects = plannerRes?.value || [];
            const tasks = [];

            projects.forEach(proj => {
                const projectName = proj.msdyn_subject || '';
                const projectTasks = proj.msdyn_tasks || [];
                if (Array.isArray(projectTasks) && projectTasks.length > 0) {
                    projectTasks.forEach((t, idx) => {
                        // msdyn_progress is a decimal between 0 and 1
                        const progressValue = t.msdyn_progress ? Math.round(t.msdyn_progress * 100) : 0;
                        const parentTaskLabel = t["_msdyn_parenttask_value@OData.Community.Display.V1.FormattedValue"];
                        const grupoValue = parentTaskLabel || projectName || plannerName;
                        tasks.push({
                            Tarea: t.msdyn_subject || `Tarea ${idx + 1}`,
                            porcentaje_100: Number(progressValue) || 0,
                            porcentaje: Number(progressValue) || 0,
                            Grupo: grupoValue,
                            posicion: Number(t.msdyn_displaysequence) || idx + 1,
                            Estado: t.statuscode,
                            nivel_tarea: t.msdyn_outlinelevel,
                            FechaInicio: t.msdyn_start,
                            FechaFin: t.msdyn_finish,
                        });
                    });
                }
            });

            // Obtener casos y comentarios relacionados al planner (si existen)
            const casos = await this.getCasoPorPlanner(plannerName).catch(err => {
                console.error('Error fetching casos por planner:', err);
                return [];
            });

            console.log(`getPlannerReportData: plannerName="${plannerName}", tasks=${tasks.length}, casos=${casos.length}`);
            return { tasks, meta: { plannerName, casos } };
        } catch (err) {
            console.error('getPlannerReportData error:', err);
            return { tasks: [], meta: { plannerName, casos: [] } };
        }
    }


    async getListaDeCarteras() {
        const token = await this.getAccessTokenForUpgrade();
        const upgradeWebApiUrl = "https://orgf61000bc.api.crm.dynamics.com/api/data/v9.2";
        const parameters = new URLSearchParams({      
            "$select": "msdyn_programid,msdyn_name,createdon"
        });
        const response = await fetch(`${upgradeWebApiUrl}/msdyn_folders?${parameters.toString()}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error fetching carteras: ${response.statusText} - ${errorText}`);
        }
        return response.json();
    }
}