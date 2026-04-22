import { DefaultAzureCredential } from "@azure/identity";

export function getAzureCredential() {
  // DefaultAzureCredential detecta automáticamente:
  // - Managed Identity cuando se ejecuta en App Service (producción)
  // - Variables de entorno AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID
  // - Azure CLI en desarrollo local
  // - Otras credenciales disponibles en la máquina
  
  const isAppService = process.env.WEBSITE_INSTANCE_ID ? true : false;
  
  if (isAppService) {
  } else {
  }
  
  return new DefaultAzureCredential();
}
