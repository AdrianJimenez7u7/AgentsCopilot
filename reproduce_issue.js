import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function reproduce() {
    try {
        // Find the record from the screenshot
        // TotalImpresiones: 192406
        // ImpresionesBN: 146175
        // ImpresionesColor: 46331
        const record = await prisma.contadores.findFirst({
            where: {
                TotalImpresiones: 192406,
                ImpresionesBN: 146175,
                ImpresionesColor: 46331
            }
        });

        if (!record) {
            // Try searching just by TotalImpresiones
            const record2 = await prisma.contadores.findFirst({
                where: { TotalImpresiones: 192406 }
            });
            if (record2) {
                // Use this record
                await analyze(record2);
            } else {
            }
            return;
        }
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
        registroAnterior = await prisma.contadoresInfoClientes.findFirst({
            where: {
                Cliente: r.Cliente,
                Serie: r.Serie
            },
            orderBy: { id: 'desc' }
        });
    }

    const bnActual = r.ImpresionesBN || 0;
    const colorActual = r.ImpresionesColor || 0;
    const bnAnterior = registroAnterior?.BN || 0;
    const colorAnterior = registroAnterior?.Color || 0;

    const diferenciasBN = Math.max(0, bnActual - bnAnterior);
    const diferenciasColor = Math.max(0, colorActual - colorAnterior);

    // Check categorization logic
    const tipo = (r.TipoImpresora || '').toLowerCase();
    const isColor = tipo.includes('color');
}

reproduce();
