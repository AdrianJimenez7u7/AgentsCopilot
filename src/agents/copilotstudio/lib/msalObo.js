import { ConfidentialClientApplication } from "@azure/msal-node";

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