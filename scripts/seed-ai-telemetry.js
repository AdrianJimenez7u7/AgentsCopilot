import 'dotenv/config';
import pkg from '@prisma/client';

const { PrismaClient } = pkg;
const prisma = new PrismaClient();

async function ensureModel({ name, version, proveedor, status }) {
  const found = await prisma.models.findFirst({
    where: {
      name,
      version: version || null,
      proveedor,
    },
  });

  if (found) return found;

  return prisma.models.create({
    data: {
      name,
      version: version || null,
      proveedor,
      status: status || 'active',
    },
  });
}

async function main() {
  const modelPrimary = await ensureModel({
    name: 'free',
    version: null,
    proveedor: 'openrouter',
    status: 'active',
  });

  const modelBridge = await ensureModel({
    name: 'nemotron-nano-12b-v2-vl',
    version: 'free',
    proveedor: 'nvidia',
    status: 'active',
  });

  let agent = await prisma.agentes.findFirst({
    where: { nombre_logico: 'computer_use' },
  });

  if (!agent) {
    agent = await prisma.agentes.create({
      data: {
        nombre_logico: 'computer_use',
        nombre_publico: 'Computer Use',
        plataforma: 'web',
        estatus: 'active',
        idModelo: modelPrimary.id,
      },
    });
  } else {
    agent = await prisma.agentes.update({
      where: { id: agent.id },
      data: {
        nombre_publico: agent.nombre_publico || 'Computer Use',
        plataforma: agent.plataforma || 'web',
        estatus: agent.estatus || 'active',
        idModelo: modelPrimary.id,
      },
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        modelPrimary: {
          id: modelPrimary.id,
          proveedor: modelPrimary.proveedor,
          name: modelPrimary.name,
          version: modelPrimary.version,
        },
        modelBridge: {
          id: modelBridge.id,
          proveedor: modelBridge.proveedor,
          name: modelBridge.name,
          version: modelBridge.version,
        },
        agent: {
          id: agent.id,
          nombre_logico: agent.nombre_logico,
          nombre_publico: agent.nombre_publico,
          idModelo: agent.idModelo,
        },
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error('SEED_FAILED', err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
