import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function reproduce() {
    try {
        // Find the record from the screenshot
        // TotalImpresiones: 192406
        // ImpresionesBN: 146175
        // ImpresionesColor: 46331

        console.log('Searching for record...');
        const record = await prisma.contadores.findFirst({
            where: {
                TotalImpresiones: 192406,
                ImpresionesBN: 146175,
                ImpresionesColor: 46331
            }
        });

        if (!record) {
            console.log('Record not found with exact match!');
            // Try searching just by TotalImpresiones
            const record2 = await prisma.contadores.findFirst({
                where: { TotalImpresiones: 192406 }
            });
            if (record2) {
                console.log('Found by TotalImpresiones only:', record2);
                // Use this record
                await analyze(record2);
            } else {
                console.log('Record not found even by TotalImpresiones.');
            }
            return;
        }

        console.log('Found record with exact match:', record);
        await analyze(record);

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

async function analyze(r) {
    // Simulate the logic in report.service.js
    let registroAnterior = null;

    if (r.Modelo) {
        console.log(`Searching previous record for Cliente: ${r.Cliente}, Serie: ${r.Serie}, Modelo: ${r.Modelo}`);
        registroAnterior = await prisma.contadoresInfoClientes.findFirst({
            where: {
                Cliente: r.Cliente,
                Serie: r.Serie,
                Modelo: r.Modelo
            },
            orderBy: { id: 'desc' }
        });
    }

    if (!registroAnterior) {
        console.log('Not found by Modelo. Searching by Serie only...');
        registroAnterior = await prisma.contadoresInfoClientes.findFirst({
            where: {
                Cliente: r.Cliente,
                Serie: r.Serie
            },
            orderBy: { id: 'desc' }
        });
    }

    console.log('Registro Anterior:', registroAnterior);

    const bnActual = r.ImpresionesBN || 0;
    const colorActual = r.ImpresionesColor || 0;
    const bnAnterior = registroAnterior?.BN || 0;
    const colorAnterior = registroAnterior?.Color || 0;

    const diferenciasBN = Math.max(0, bnActual - bnAnterior);
    const diferenciasColor = Math.max(0, colorActual - colorAnterior);

    console.log('Calculations:');
    console.log(`BN Actual: ${bnActual}`);
    console.log(`BN Anterior: ${bnAnterior}`);
    console.log(`Diff BN: ${diferenciasBN}`);
    console.log(`Color Actual: ${colorActual}`);
    console.log(`Color Anterior: ${colorAnterior}`);
    console.log(`Diff Color: ${diferenciasColor}`);

    // Check categorization logic
    const tipo = (r.TipoImpresora || '').toLowerCase();
    const isColor = tipo.includes('color');
    console.log(`TipoImpresora: ${r.TipoImpresora}, isColor: ${isColor}`);
}

reproduce();
