import { BlobServiceClient } from "@azure/storage-blob";
import { getAzureCredential } from "./azureCredential.js";

const credential = getAzureCredential();

function getContainerClient() {
  const account = process.env.BLOB_ACCOUNT;
  const container = process.env.BLOB_CONTAINER;
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING || process.env.BLOB_CONNECTION_STRING;

  // Prioridad: connection string (si está disponible) > Managed Identity/credenciales
  // Connection string es útil para desarrollo local o si se prefiere auth simple
  const blobSvc = connectionString
    ? BlobServiceClient.fromConnectionString(connectionString)
    : new BlobServiceClient(`https://${account}.blob.core.windows.net`, credential);

  return blobSvc.getContainerClient(container);
}

export async function uploadCsvBuffer({ buffer, blobPath }) {
  const containerClient = getContainerClient();
  const blobClient = containerClient.getBlockBlobClient(blobPath);

  await blobClient.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: "text/csv" },
  });

  return { blobPath };
}

export async function downloadOutputCsv({ outputPrefix, outputFileName }) {
  const containerClient = getContainerClient();

  let foundName = null;

  for await (const item of containerClient.listBlobsFlat({ prefix: outputPrefix })) {
    if ((item.name || "").toLowerCase().endsWith(outputFileName.toLowerCase())) {
      foundName = item.name;
      break;
    }
  }

  if (!foundName) {
    const err = new Error(`No encontré el archivo '${outputFileName}' bajo el prefijo '${outputPrefix}'.`);
    err.statusCode = 404;
    throw err;
  }

  const blobClient = containerClient.getBlobClient(foundName);
  const download = await blobClient.download();

  return { foundBlobName: foundName, stream: download.readableStreamBody };
}
