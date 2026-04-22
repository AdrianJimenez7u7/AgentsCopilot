import { ReportService } from './services/report.service.js';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

async function runTest() {
    const reportsDir = path.join(__dirname, 'Reports');

    // 1. Clean directory
    if (fs.existsSync(reportsDir)) {
        const files = fs.readdirSync(reportsDir);
        for (const file of files) {
            fs.unlinkSync(path.join(reportsDir, file));
        }
    } else {
        fs.mkdirSync(reportsDir, { recursive: true });
    }

    // 2. Find a client to test
    const record = await prisma.contadores.findFirst({
        orderBy: { id: 'desc' }
    });

    if (!record) {
        return;
    }

    const clientName = record.Cliente;

    try {
        const result = await ReportService.generateReportFromDB({
            cliente: clientName,
            dryRun: true
        });
    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        await prisma.$disconnect();
    }
}

runTest();
