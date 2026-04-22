import 'dotenv/config';
import { prisma } from '../src/shared/prisma/client.js';

function normalizeSerie(value) {
  return String(value ?? '').trim().toUpperCase();
}

function moveDateToMarchKeepingYearDay(dateInput) {
  const current = new Date(dateInput);
  if (Number.isNaN(current.getTime())) return null;

  const updated = new Date(current);
  // Month index 2 = March (03). Preserve year, day and time.
  updated.setMonth(2);
  return updated;
}

async function main() {
  const isApply = process.argv.includes('--apply');

  const [clientes, escaneos] = await Promise.all([
    prisma.contadoresInfoClientes.findMany({
      select: {
        id: true,
        Cliente: true,
        Serie: true,
        FechaLimiteReporte: true,
      },
    }),
    prisma.contadores.findMany({
      select: {
        Serie: true,
      },
    }),
  ]);

  const scansBySerie = new Map();
  for (const scan of escaneos) {
    const key = normalizeSerie(scan.Serie);
    if (!key) continue;
    scansBySerie.set(key, (scansBySerie.get(key) || 0) + 1);
  }

  let totalNoScan = 0;
  let totalOneScan = 0;
  let totalManyScan = 0;
  let totalOneScanWithDate = 0;
  let totalUpdated = 0;

  const updatePayload = [];

  for (const cliente of clientes) {
    const key = normalizeSerie(cliente.Serie);
    const relatedScans = key ? (scansBySerie.get(key) || 0) : 0;

    if (relatedScans === 0) {
      totalNoScan += 1;
      continue;
    }

    if (relatedScans > 1) {
      totalManyScan += 1;
      continue;
    }

    totalOneScan += 1;

    if (!cliente.FechaLimiteReporte) {
      continue;
    }

    const nextDate = moveDateToMarchKeepingYearDay(cliente.FechaLimiteReporte);
    if (!nextDate) {
      continue;
    }

    totalOneScanWithDate += 1;
    updatePayload.push({
      id: cliente.id,
      cliente: cliente.Cliente,
      serie: cliente.Serie,
      from: cliente.FechaLimiteReporte,
      to: nextDate,
    });
  }

  if (!isApply) {
    const sample = updatePayload.slice(0, 20).map((row) => ({
      id: row.id,
      cliente: row.cliente,
      serie: row.serie,
      from: row.from?.toISOString?.() || String(row.from),
      to: row.to?.toISOString?.() || String(row.to),
    }));

    if (sample.length > 0) {
      console.table(sample);
    } else {
    }
    return;
  }

  for (const row of updatePayload) {
    await prisma.contadoresInfoClientes.update({
      where: { id: row.id },
      data: { FechaLimiteReporte: row.to },
    });
    totalUpdated += 1;
  }
}

main()
  .catch((error) => {
    console.error('[contadores-fix] Error:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
