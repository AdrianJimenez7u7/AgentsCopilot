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

  console.log('[contadores-fix] Iniciando proceso...');
  console.log(`[contadores-fix] Modo: ${isApply ? 'APPLY (actualiza BD)' : 'PREVIEW (sin cambios)'}`);

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

  console.log(`[contadores-fix] Impresoras cliente totales: ${clientes.length}`);
  console.log(`[contadores-fix] Sin escaneos relacionados: ${totalNoScan}`);
  console.log(`[contadores-fix] Con 1 escaneo relacionado: ${totalOneScan}`);
  console.log(`[contadores-fix] Con mas de 1 escaneo relacionado: ${totalManyScan}`);
  console.log(`[contadores-fix] Con 1 escaneo y FechaLimiteReporte valida: ${totalOneScanWithDate}`);

  if (!isApply) {
    const sample = updatePayload.slice(0, 20).map((row) => ({
      id: row.id,
      cliente: row.cliente,
      serie: row.serie,
      from: row.from?.toISOString?.() || String(row.from),
      to: row.to?.toISOString?.() || String(row.to),
    }));

    if (sample.length > 0) {
      console.log('[contadores-fix] Vista previa (primeros 20 cambios):');
      console.table(sample);
    } else {
      console.log('[contadores-fix] No hay cambios a aplicar.');
    }

    console.log('[contadores-fix] Ejecuta con --apply para aplicar cambios.');
    return;
  }

  for (const row of updatePayload) {
    await prisma.contadoresInfoClientes.update({
      where: { id: row.id },
      data: { FechaLimiteReporte: row.to },
    });
    totalUpdated += 1;
  }

  console.log(`[contadores-fix] Cambios aplicados: ${totalUpdated}`);
}

main()
  .catch((error) => {
    console.error('[contadores-fix] Error:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
