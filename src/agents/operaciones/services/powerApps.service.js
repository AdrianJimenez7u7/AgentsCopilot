
import { Constantes } from '../utils/constantes.js';

export class powerAppsService {
    static normalizeMarcaText(value) {
        return String(value ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase()
            .replace(/[^A-Z0-9 ]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    static resolveMarcaId(marcaValue) {
        const raw = String(marcaValue ?? '').trim();
        if (!raw) return '';

        // If value already starts with a valid brand id (e.g. "287 - MICROSOFT" or "287").
        const leadingId = raw.match(/^(\d{2,4})\b/);
        if (leadingId && Constantes.CodigoMarcas[leadingId[1]]) {
            return leadingId[1];
        }

        const normalizedRaw = this.normalizeMarcaText(raw);

        // 1) Exact normalized match
        const exact = Object.entries(Constantes.CodigoMarcas)
            .find(([, name]) => this.normalizeMarcaText(name) === normalizedRaw);
        if (exact) return exact[0];

        // 2) Partial contains match (e.g. "PNY TECHNOLOGIES" -> "PNY")
        const partial = Object.entries(Constantes.CodigoMarcas)
            .filter(([, name]) => {
                const normalizedName = this.normalizeMarcaText(name);
                return normalizedName && (
                    normalizedName.includes(normalizedRaw) ||
                    normalizedRaw.includes(normalizedName)
                );
            })
            // Prefer the most specific match
            .sort((a, b) => this.normalizeMarcaText(b[1]).length - this.normalizeMarcaText(a[1]).length)[0];

        return partial ? partial[0] : '';
    }

    // --- 5. OBTENER USUARIOS DEL SISTEMA (SYSTEMUSER) ---
    static async getSystemUsers(req, res) {
        try {
            console.log("👥 Obteniendo usuarios del sistema desde Dataverse...");

            // A. CONFIGURACIÓN (reutilizamos las mismas credenciales)
            const tenantId = "267e7400-d5af-4805-bce9-1e4247c0c3a7";
            const clientId = "6840a6b2-7154-4c5d-8081-003edd0da715";
            const clientSecret = process.env.DYNAMIC_SECRET;
            const scope = "https://ccad.api.crm.dynamics.com/.default";

            // B. OBTENER TOKEN
            const tokenParams = new URLSearchParams();
            tokenParams.append('client_id', clientId);
            tokenParams.append('scope', scope);
            tokenParams.append('client_secret', clientSecret);
            tokenParams.append('grant_type', 'client_credentials');

            const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
                method: 'POST',
                body: tokenParams
            });

            if (!tokenResponse.ok) throw new Error("Fallo al obtener token: " + await tokenResponse.text());
            const { access_token } = await tokenResponse.json();

            // C. CONSULTAR SYSTEMUSER
            // Filtramos usuarios activos con email @compucad.com.mx
            const dataverseUrl = `https://ccad.api.crm.dynamics.com/api/data/v9.2/systemusers?$select=systemuserid,fullname,internalemailaddress,title,_businessunitid_value&$filter=isdisabled eq false and internalemailaddress ne null and endswith(internalemailaddress,'@compucad.com.mx')&$orderby=fullname asc&$top=500`;

            const dataResponse = await fetch(dataverseUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'odata.include-annotations="*"'
                }
            });

            if (!dataResponse.ok) throw new Error("Error en Dataverse: " + await dataResponse.text());

            const json = await dataResponse.json();
            const users = json.value || [];

            console.log(`✅ Se obtuvieron ${users.length} usuarios @compucad.com.mx`);

            // D. MAPEAR A FORMATO LIMPIO
            const mappedUsers = users
                .filter(u => u.internalemailaddress && u.internalemailaddress.endsWith('@compucad.com.mx'))
                .map(user => ({
                    id: user.systemuserid,
                    displayName: user.fullname || 'Sin nombre',
                    email: user.internalemailaddress,
                    title: user.title || null,
                    businessUnit: user['_businessunitid_value@OData.Community.Display.V1.FormattedValue'] || 'Sin unidad'
                }));

            // E. AGRUPAR POR UNIDAD DE NEGOCIO
            const byBusinessUnit = {};
            mappedUsers.forEach(user => {
                const unit = user.businessUnit || 'Sin unidad';
                if (!byBusinessUnit[unit]) {
                    byBusinessUnit[unit] = [];
                }
                byBusinessUnit[unit].push(user);
            });

            // Ordenar unidades alfabéticamente
            const sortedUnits = Object.keys(byBusinessUnit).sort();

            res.json({
                total: mappedUsers.length,
                users: mappedUsers,
                businessUnits: sortedUnits,
                byBusinessUnit: byBusinessUnit
            });

        } catch (error) {
            console.error('❌ Error al obtener usuarios:', error);
            res.status(500).json({ error: error.message });
        }
    }

    // --- 6. GESTIÓN DE ARCHIVOS (MIGRADO A SHAREPOINT) ---
    // IDs obtenidos mediante script de prueba (Sub-sitio TD)
    static DRIVE_ID = "b!bSuHMmR-nUmBip_FT67_ODpp-ZUHAWZFq91jHGiCJADUKY-CuWOtQ5coNu0a6zDL";
    static SHAREPOINT_FOLDER = "/Agentes/Aria";
    static SHAREPOINT_SITE_ID = 'compucad1.sharepoint.com,32872b6d-7e64-499d-818a-9fc54faeff38,95f9693a-0107-4566-abdd-631c68822400';
    static SHAREPOINT_LIST_ID = '7c087114-705b-4d65-af5a-1cd6012f1160';

    // Helper para obtener token de Graph API
    static async _getGraphToken() {
        const tenantId = "267e7400-d5af-4805-bce9-1e4247c0c3a7";
        const clientId = "6840a6b2-7154-4c5d-8081-003edd0da715";
        const clientSecret = process.env.DYNAMIC_SECRET;
        const scope = "https://graph.microsoft.com/.default";

        const tokenParams = new URLSearchParams();
        tokenParams.append('client_id', clientId);
        tokenParams.append('scope', scope);
        tokenParams.append('client_secret', clientSecret);
        tokenParams.append('grant_type', 'client_credentials');

        const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
            method: 'POST', body: tokenParams
        });

        if (!tokenResponse.ok) throw new Error("Error obteniendo token Graph: " + await tokenResponse.text());
        const { access_token } = await tokenResponse.json();
        return access_token;
    }



    static async getMyCity(email) {
        try {
            const tenantId = "267e7400-d5af-4805-bce9-1e4247c0c3a7";
            const clientId = "6840a6b2-7154-4c5d-8081-003edd0da715";
            const clientSecret = process.env.DYNAMIC_SECRET;
            const scope = "https://ccad.api.crm.dynamics.com/.default";

            // B. OBTENER TOKEN
            const tokenParams = new URLSearchParams();
            tokenParams.append('client_id', clientId);
            tokenParams.append('scope', scope);
            tokenParams.append('client_secret', clientSecret);
            tokenParams.append('grant_type', 'client_credentials');

            const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
                method: 'POST',
                body: tokenParams
            });

            if (!tokenResponse.ok) throw new Error("Fallo al obtener token: " + await tokenResponse.text());
            const { access_token } = await tokenResponse.json();

            // C. CONSULTAR SYSTEMUSER
            // Filtramos usuarios activos con email @compucad.com.mx
            const dataverseUrl = `https://ccad.api.crm.dynamics.com/api/data/v9.2/systemusers?$select=systemuserid,fullname,internalemailaddress,title,_businessunitid_value,address1_composite&$filter=isdisabled eq false and internalemailaddress ne null and internalemailaddress eq '${email}'&$top=1`;

            const dataResponse = await fetch(dataverseUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${access_token}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'odata.include-annotations="*"'
                }
            });

            if (!dataResponse.ok) throw new Error("Error en Dataverse: " + await dataResponse.text());

            const json = await dataResponse.json();
            const raw = json.value?.[0];
            if (!raw) return null;

            // Map to clean object — Copilot Studio fails on null fields typed as String
            return {
                systemuserid: raw.systemuserid ?? '',
                fullname: raw.fullname ?? '',
                internalemailaddress: raw.internalemailaddress ?? '',
                title: raw.title ?? '',
                address1_city: raw.address1_city ?? '',
                address1_stateorprovince: raw.address1_stateorprovince ?? '',
                address1_country: raw.address1_country ?? '',
                address1_composite: raw.address1_composite ?? '',
                businessUnit: raw['_businessunitid_value@OData.Community.Display.V1.FormattedValue'] ?? '',
            };




        } catch (error) {
            console.error('❌ Error al obtener mi ciudad:', error);
            return null;
        }
    }

    static async insertProductInSharepointList(product) {
        try {
            const graphToken = await this._getGraphToken();
            const siteId = this.SHAREPOINT_SITE_ID;
            const listId = this.SHAREPOINT_LIST_ID;
            const marcaId = this.resolveMarcaId(product.marca);

            // Parse dimensions from variants like '10x5x3' or '13.5 x 13 x 2'.
            let ancho = 0, altura = 0, longitud = 0;
            if (product.medidas_cm) {
                const parts = String(product.medidas_cm)
                    .toLowerCase()
                    .split(/x|×/i)
                    .map(p => parseFloat(p.trim().replace(',', '.')));
                if (parts.length === 3 && parts.every(p => !isNaN(p))) {
                    [ancho, altura, longitud] = parts;
                }
            }

            const payload = {
                fields: {
                    Title: product.numero_parte || product.sku,
                    Descripcion: product.descripcion_comercial,
                    C_x00f3_digodeclasificaci_x00f3_: product.clave_producto_servicio_sat,
                    Unidaddemedida: product.clave_unidad_sat,
                    Marca: marcaId || product.marca,
                    peso: String(product.peso_kg || 0),
                    ancho: String(ancho),
                    altura: String(altura),
                    Longitud: String(longitud),
                    Estatus: 'Verificado',
                }
            };

            if (!marcaId) {
                console.warn(`⚠️ No se pudo resolver ID de marca para "${product.marca}". Se enviará valor original.`);
            }

            const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items`;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${graphToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error("Error insertando producto: " + await response.text());
            }

            const json = await response.json();
            console.log(`✅ Producto insertado en SharePoint con ID: ${json.id}`);
            return json;
        } catch (error) {
            console.error('❌ Error al insertar producto en SharePoint:', error);
            throw error;
        }
    }

    static async getProductsFromSharepointList() {
        try {
            const graphToken = await this._getGraphToken();

            // IDs confirmed via Graph API diagnostic
            const siteId = this.SHAREPOINT_SITE_ID;
            const listId = this.SHAREPOINT_LIST_ID; // "CCADDEV210 - Alta de productos en SAP"

            const allItems = [];
            let url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?expand=fields&$top=999`;

            // Handle pagination — Graph returns max 200 items per page by default
            while (url) {
                const response = await fetch(url, {
                    headers: {
                        'Authorization': `Bearer ${graphToken}`,
                        'Content-Type': 'application/json',
                    }
                });
                if (!response.ok) throw new Error("Error obteniendo productos: " + await response.text());
                const json = await response.json();

                const page = (json.value || []).map(item => item.fields);
                allItems.push(...page);

                url = json['@odata.nextLink'] || null;
            }

            // Map SharePoint fields → PendingProduct shape
            const products = allItems.map(f => ({
                id: parseInt(f.id, 10),
                sku: f.Title || '',
                descripcion_comercial: (f.Descripcion || '').trim(),
                clave_producto_servicio_sat: f['C_x00f3_digodeclasificaci_x00f3_'] || '',
                clave_unidad_sat: f.Unidaddemedida || '',
                marca: f.Marca || '',
                medidas_cm: `${f.ancho || 0} x ${f.altura || 0} x ${f.Longitud || 0}`,
                peso_kg: parseFloat(f.peso) || 0,
                user_email: '',   // AuthorLookupId is a numeric ID, not an email — expand separately if needed
                status: f.Estatus || 'Pendiente',
                createdAt: f.Created || new Date().toISOString(),
            }));

            console.log(`✅ Productos obtenidos de SharePoint: ${products.length}`);
            return products;
        } catch (error) {
            console.error('❌ Error al obtener productos:', error);
            return null;
        }
    }

    /** Temporary helper endpoint support to validate which SharePoint list is configured. */
    static async getSharepointListMetadata() {
        const graphToken = await this._getGraphToken();
        const siteId = this.SHAREPOINT_SITE_ID;
        const listId = this.SHAREPOINT_LIST_ID;

        const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${graphToken}`,
                'Content-Type': 'application/json',
            }
        });

        if (!response.ok) {
            throw new Error("Error obteniendo metadata de SharePoint list: " + await response.text());
        }

        const list = await response.json();
        return {
            configuredSiteId: siteId,
            configuredListId: listId,
            graphListId: list.id,
            displayName: list.displayName,
            webUrl: list.webUrl,
            createdDateTime: list.createdDateTime,
            lastModifiedDateTime: list.lastModifiedDateTime,
        };
    }
}