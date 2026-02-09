import * as XLSX from "xlsx";
import { ResultadosData } from "../data/resultados.data.js";

function findPredictionColumn(headers) {
  const h = headers.find((x) => String(x).toLowerCase().startsWith("prediccion"));
  return h ?? null;
}

export class ResultadosService {
  static async getPrediccionRows({ modeloSlug, mesObjetivo }) {
    const row = await ResultadosData.getLatestInferOutputFile({ modeloSlug, mesObjetivo });

    if (!row) return { rows: [], fileName: null, predCol: null };

    const buf = row.FileContent; // Buffer
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheetName = wb.SheetNames?.[0];

    if (!sheetName) return { rows: [], fileName: row.FileName, predCol: null };

    const ws = wb.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(ws, { defval: null });

    const headers = Object.keys(json?.[0] ?? {});
    const predCol = findPredictionColumn(headers);

    return { fileName: row.FileName, predCol, rows: json };
  }
}
