import { PrismaClient } from '@prisma/client';

const prisma = globalThis.__prisma || new PrismaClient();
if (!globalThis.__prisma) globalThis.__prisma = prisma;

export { prisma };