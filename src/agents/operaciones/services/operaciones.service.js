import XLSX from 'xlsx';
import { randomUUID } from 'crypto';
import { SearchService } from './search.service.js';
import { OpenAIService } from './openAI.service.js';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Run async tasks with a max concurrency limit */
async function runWithConcurrency(tasks, limit = 5) {
    const results = [];
    const executing = [];
    for (const task of tasks) {
        const p = Promise.resolve().then(task).then(r => {
            executing.splice(executing.indexOf(p), 1);
            return r;
        });
        results.push(p);
        executing.push(p);
        if (executing.length >= limit) {
            await Promise.race(executing);
        }
    }
    return Promise.allSettled(results);
}

export class operacionesService {
    static async extractSKUfromXLSX(file, userEmail) {
        const telemetry = {
            runId: randomUUID(),
            collaboratorId: userEmail || null,
        };

        const workbook = XLSX.readFile(file.path);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet);

        // Extract SKUs from the "Número de artículo" column
        const skus = data
            .map(row => {
                const key = Object.keys(row).find(k => k.trim() === 'Número de artículo');
                return key ? String(row[key]).trim() : null;
            })
            .filter(Boolean);

        if (skus.length === 0) {
            return { count: 0, skipped: 0, message: 'No se encontraron SKUs en el archivo.' };
        }

        // ✅ Check which SKUs already exist in DB (any status) — skip them
        const existentes = await prisma.productoPendienteValidation.findMany({
            where: { sku: { in: skus } },
            select: { sku: true },
        });
        const skusExistentes = new Set(existentes.map(e => e.sku));
        const skusNuevos = skus.filter(sku => !skusExistentes.has(sku));

        console.log(`SKUs en archivo: ${skus.length} | Ya en BD: ${skusExistentes.size} | A procesar: ${skusNuevos.length}`);

        if (skusNuevos.length === 0) {
            return {
                processed: [],
                skipped: [...skusExistentes],
                errors: [],
                message: 'Todos los SKUs ya existen en la base de datos.',
            };
        }

        // Phase 1: run all Tavily searches in parallel (fast, no AI cost)
        console.log(`[XLSX] Fase 1: buscando ${skusNuevos.length} SKUs en paralelo con Tavily...`);
        const searchResults = await Promise.allSettled(
            skusNuevos.map(sku => SearchService.search(sku, 2, telemetry))
        );

        // Build batch only with valid search contexts (technology relevance gate)
        const items = [];
        const itemSkuIndexes = [];
        const skusConError = [];

        skusNuevos.forEach((sku, i) => {
            const settled = searchResults[i];
            const value = settled.status === 'fulfilled' ? settled.value : null;
            if (value?.results?.length) {
                items.push({
                    sku,
                    context: JSON.stringify(value),
                });
                itemSkuIndexes.push(i);
            } else {
                skusConError.push(sku);
            }
        });

        if (skusConError.length > 0) {
            console.warn(`[XLSX] SKUs rechazados por falta de contexto tecnológico confiable: ${skusConError.join(', ')}`);
        }

        if (items.length === 0) {
            return {
                processed: [],
                skipped: [...skusExistentes],
                errors: skusConError,
                message: `0 guardados, ${skusExistentes.size} omitidos, ${skusConError.length} con error de búsqueda.`,
            };
        }

        // Phase 2: classify ALL SKUs in a single AI call (system prompt sent only once)
        console.log(`[XLSX] Fase 2: clasificando ${items.length} SKUs en lote con modelo de razonamiento...`);
        const clasificados = await OpenAIService.clasificarProductosLote(items, 3, telemetry);

        const settled = clasificados.map((producto, i) => ({
            status: producto ? 'fulfilled' : 'rejected',
            value: producto ? {
                sku: producto.numero_parte || skusNuevos[i],
                descripcion_comercial: producto.descripcion_comercial,
                clave_producto_servicio_sat: producto.clave_producto_servicio_sat,
                clave_unidad_sat: producto.clave_unidad_sat,
                marca: producto.marca,
                medidas_cm: producto.medidas_cm,
                peso_kg: parseFloat(producto.peso_kg) || 0,
                user_email: userEmail || 'unknown@example.com',
                status: 'Pending',
            } : null,
        }));

        const productos = [];
        const skusProcesados = [];
        settled.forEach((result, i) => {
            const skuIndex = itemSkuIndexes[i];
            const sku = skusNuevos[skuIndex];
            if (result.status === 'fulfilled' && result.value) {
                productos.push(result.value);
                skusProcesados.push(sku);
            } else {
                skusConError.push(sku);
            }
        });

        if (skusConError.length > 0) {
            console.warn(`SKUs con error: ${skusConError.join(', ')}`);
        }

        // Token logs are printed by clasificarProductosLote directly


        // Save to DB
        if (productos.length > 0) {
            await prisma.productoPendienteValidation.createMany({ data: productos });
        }

        return {
            processed: skusProcesados,
            skipped: [...skusExistentes],
            errors: skusConError,
            message: `${skusProcesados.length} guardados, ${skusExistentes.size} omitidos, ${skusConError.length} con error.`,
        };
    }
}