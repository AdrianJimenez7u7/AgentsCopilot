import axios from "axios";
import crypto from "crypto";
import { requireEnv } from "../utils/requireEnv.js";
import { uploadCsvBuffer } from "./blob.service.js";
import { getAzureCredential } from "./azureCredential.js";

const credential = getAzureCredential();

function datastoreId() {
  const sub = process.env.AZ_SUBSCRIPTION_ID;
  const rg = process.env.AZ_RESOURCE_GROUP;
  const ws = process.env.AZ_ML_WORKSPACE;

  return `/subscriptions/${sub}/resourceGroups/${rg}/providers/Microsoft.MachineLearningServices/workspaces/${ws}/datastores/workspaceblobstore`;
}

function datastorePathUri(dataPath) {
  return `${datastoreId()}/paths/${dataPath}`;
}

async function getMlToken() {
  const scope = process.env.AZURE_ML_SCOPE || "https://ml.azure.com/.default";
  const tok = await credential.getToken(scope);
  return tok.token;
}

async function getMgmtToken() {
  const scope = process.env.AZURE_MGMT_SCOPE || "https://management.azure.com/.default";
  const tok = await credential.getToken(scope);
  return tok.token;
}

export async function invokeGastosBatch({ csvBuffer, endpoint, deployment }) {
  requireEnv([
    "AZ_SUBSCRIPTION_ID",
    "AZ_RESOURCE_GROUP",
    "AZ_ML_WORKSPACE",
    "AML_INVOKE_URL",
    "AML_INPUT_PREFIX",
    "AML_OUTPUT_PREFIX",
    "BLOB_ACCOUNT",
    "BLOB_CONTAINER",
  ]);

  // Si no se proporciona deployment, usar variable de entorno
  const deploymentName = deployment || process.env.AML_DEPLOYMENT;
  if (!deploymentName) {
    const err = new Error("No se especificó deployment. Proporciona 'deployment' como parámetro o variable de entorno AML_DEPLOYMENT.");
    err.statusCode = 400;
    throw err;
  }

  const jobKey = crypto.randomUUID();
  const inputPrefix = process.env.AML_INPUT_PREFIX;
  const outputPrefix = process.env.AML_OUTPUT_PREFIX;

  const inputBlobPath = `${inputPrefix}/${jobKey}.csv`;
  await uploadCsvBuffer({ buffer: csvBuffer, blobPath: inputBlobPath });

  const inputUri = datastorePathUri(inputBlobPath);
  const outputFolderPath = `${outputPrefix}/${jobKey}`;
  const outputUriFolder = datastorePathUri(outputFolderPath);

  const body = {
    properties: {
      InputData: {
        input_data: {
          JobInputType: "UriFile",
          Uri: inputUri,
        },
      },
      OutputData: {
        score: {
          JobOutputType: "UriFolder",
          Uri: outputUriFolder,
        },
      },
    },
  };

  const token = await getMlToken();

  const resp = await axios.post(process.env.AML_INVOKE_URL, body, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "azureml-model-deployment": deploymentName,
    },
    validateStatus: () => true,
  });

  const payloadText = JSON.stringify(resp.data || {});
  if (resp.status === 400 && payloadText.includes("JobOutputType")) {
    const outputFileName = process.env.AML_OUTPUT_FILENAME || "predicciones_gastos_un_sucursal.csv";
    const outputFilePath = `${outputFolderPath}/${outputFileName}`;
    const outputUriFile = datastorePathUri(outputFilePath);

    const body2 = {
      properties: {
        InputData: body.properties.InputData,
        OutputData: {
          score: { JobOutputType: "UriFile", Uri: outputUriFile },
        },
      },
    };

    const resp2 = await axios.post(process.env.AML_INVOKE_URL, body2, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "azureml-model-deployment": deploymentName,
      },
      validateStatus: () => true,
    });

    if (resp2.status < 200 || resp2.status >= 300) {
      const err = new Error("Falló la invocación del batch endpoint (fallback UriFile).");
      err.statusCode = 500;
      err.details = resp2.data;
      throw err;
    }

    return {
      jobKey,
      amlJobName: resp2.data?.name || resp2.data?.id || null,
      inputBlobPath,
      outputPrefix: outputFolderPath,
      usedOutputType: "UriFile",
    };
  }

  if (resp.status < 200 || resp.status >= 300) {
    const err = new Error("Falló la invocación del batch endpoint.");
    err.statusCode = 500;
    err.details = resp.data;
    throw err;
  }

  return {
    jobKey,
    amlJobName: resp.data?.name || resp.data?.id || null,
    inputBlobPath,
    outputPrefix: outputFolderPath,
    usedOutputType: "UriFolder",
  };
}

export async function getJobStatus(jobName) {
  requireEnv(["AZ_SUBSCRIPTION_ID", "AZ_RESOURCE_GROUP", "AZ_ML_WORKSPACE", "AZURE_MGMT_API_VERSION"]);

  const sub = process.env.AZ_SUBSCRIPTION_ID;
  const rg = process.env.AZ_RESOURCE_GROUP;
  const ws = process.env.AZ_ML_WORKSPACE;
  const apiVersion = process.env.AZURE_MGMT_API_VERSION;

  const url =
    `https://management.azure.com/subscriptions/${sub}/resourceGroups/${rg}` +
    `/providers/Microsoft.MachineLearningServices/workspaces/${ws}/jobs/${encodeURIComponent(jobName)}` +
    `?api-version=${encodeURIComponent(apiVersion)}`;

  const token = await getMgmtToken();
  const resp = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true,
  });

  if (resp.status < 200 || resp.status >= 300) {
    const err = new Error("No pude consultar el job en Azure ML.");
    err.statusCode = resp.status;
    err.details = resp.data;
    throw err;
  }

  return {
    status: resp.data?.properties?.status || null,
    raw: resp.data,
  };
}
