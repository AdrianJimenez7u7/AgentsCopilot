import * as XLSX from "xlsx";
import Papa from "papaparse";

export function readExcelHeadersAndSampleRowFromBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
  const headerRow = rows?.[0] ?? [];
  const sampleRow = rows?.[1] ?? [];

  const headers = headerRow.map((x) => String(x ?? "").trim());
  return { headers, sampleRow, sheetName };
}

export function readCsvHeadersAndSampleRowFromBuffer(buffer) {
  const text = buffer.toString("utf-8");
  const parsed = Papa.parse(text, { skipEmptyLines: true });

  const data = parsed.data ?? [];
  const headerRow = data?.[0] ?? [];
  const sampleRow = data?.[1] ?? [];

  const headers = headerRow.map((x) => String(x ?? "").trim());
  return { headers, sampleRow };
}
