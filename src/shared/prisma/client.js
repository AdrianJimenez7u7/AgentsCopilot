import pkg from '@prisma/client';
const { PrismaClient } = pkg;

const prisma = globalThis.__prisma || new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});
if (!globalThis.__prisma) globalThis.__prisma = prisma;

export { prisma };