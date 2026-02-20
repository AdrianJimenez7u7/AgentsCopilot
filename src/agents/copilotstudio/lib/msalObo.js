import { ConfidentialClientApplication } from "@azure/msal-node";

// Validar variables de entorno
if (!process.env.AZURE_BACKEND_CLIENT_ID || !process.env.AZURE_BACKEND_CLIENT_SECRET) {
  console.error('❌ Variables de entorno faltantes o inválidas:', {
    hasClientId: !!process.env.AZURE_BACKEND_CLIENT_ID,
    hasClientSecret: !!process.env.AZURE_BACKEND_CLIENT_SECRET,
    hasTenantId: !!process.env.AZURE_TENANT_ID,
    clientIdValue: process.env.AZURE_BACKEND_CLIENT_ID ? '***' + process.env.AZURE_BACKEND_CLIENT_ID.slice(-8) : 'MISSING',
    tenantIdValue: process.env.AZURE_TENANT_ID ? process.env.AZURE_TENANT_ID : 'MISSING'
  });
}

const cca = new ConfidentialClientApplication({
  auth: {
    clientId: process.env.AZURE_BACKEND_CLIENT_ID,
    clientSecret: process.env.AZURE_BACKEND_CLIENT_SECRET,
    authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
  },
});

export async function acquireTokenObo(userAccessToken, scopes) {
  return cca.acquireTokenOnBehalfOf({
    oboAssertion: userAccessToken,
    scopes,
    skipCache: false,
  });
}