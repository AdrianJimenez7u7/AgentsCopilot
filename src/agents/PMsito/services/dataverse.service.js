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
        const parameters = new URLSearchParams();
        parameters.set("$select", "annotationid,notetext,createdon,_objectid_value");
        parameters.set("$expand", "objectid_incident($select=incidentid,title,ticketnumber)");
        let filter = "objecttypecode eq 'incident'";
        if (casoId) {
            filter += ` and _objectid_value eq ${casoId}`;
        }
        parameters.set("$filter", filter);
        const response = await fetch(`${this.webApiUrl}/annotations?${parameters.toString()}`, {
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
            throw new Error(`Error fetching comentarios: ${response.status} - ${errorText}`);
        }

        return response.json();
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