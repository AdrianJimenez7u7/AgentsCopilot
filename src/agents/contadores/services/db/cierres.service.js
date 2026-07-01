import { prisma } from '../../../../shared/prisma/client.js';
import { logger } from '../../../../shared/utils/logger.js';

export class CierresService {
  static async obtenerTodos({ clienteNombre, tecnico } = {}) {
    const where = {};
    if (clienteNombre) where.ClienteNombre = { contains: clienteNombre };
    if (tecnico) where.Tecnico = { contains: tecnico };

    return prisma.contadoresCierres.findMany({
      where,
      include: { comentario: true },
      orderBy: { FechaCierre: 'desc' }
    });
  }

  static async obtenerPorId(id) {
    return prisma.contadoresCierres.findUnique({
      where: { id },
      include: { comentario: true }
    });
  }

  static async eliminar(id) {
    return prisma.contadoresCierres.delete({ where: { id } });
  }

  /**
   * Ejecuta el cierre formal de todas las impresoras pendientes de un cliente.
   * Agrupa por técnico, calcula deltas vs escaneo anterior y crea un ContadoresCierres por grupo.
   * Al finalizar marca todos los Contadores pendientes del cliente como 'Reportado'.
   */
  static async cierreFormal(clienteNombre, comentarioId = null) {
    // 1. Obtener todos los escaneos pendientes del cliente
    const pendientes = await prisma.contadores.findMany({
      where: { Cliente: clienteNombre, Estatus: null }
    });

    // 2. Verificar que no exista ya un cierre del cliente en el mes actual
    const hoy = new Date();
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const inicioMesSiguiente = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 1);

    const cierreExistente = await prisma.contadoresCierres.findFirst({
      where: {
        ClienteNombre: clienteNombre,
        FechaCierre: { gte: inicioMes, lt: inicioMesSiguiente }
      }
    });

    if (cierreExistente) {
      throw new Error(`Ya existe un cierre para el cliente "${clienteNombre}" en el mes actual`);
    }

    // 3. Obtener catálogo completo del cliente para precios y técnicos
    const impresoras = await prisma.contadoresInfoClientes.findMany({
      where: { Cliente: clienteNombre }
    });

    if (impresoras.length === 0) {
      throw new Error(`No se encontraron impresoras registradas para el cliente: ${clienteNombre}`);
    }

    const impresoraMap = new Map(impresoras.map(i => [i.Serie, i]));

    // 3. Calcular deltas si hay escaneos pendientes
    const deltasPorSerie = await Promise.all(
      pendientes.map(async (r) => {
        const anterior = await prisma.contadores.findFirst({
          where: { Serie: r.Serie, id: { lt: r.id } },
          orderBy: { id: 'desc' }
        });
        return {
          serie: r.Serie,
          deltaBN: Math.max(0, (r.ImpresionesBN || 0) - (anterior?.ImpresionesBN || 0)),
          deltaColor: Math.max(0, (r.ImpresionesColor || 0) - (anterior?.ImpresionesColor || 0))
        };
      })
    );
    const deltaMap = new Map(deltasPorSerie.map(d => [d.serie, d]));

    // 4. Agrupar todas las impresoras del catálogo por técnico y acumular
    const porTecnico = new Map();
    for (const impresora of impresoras) {
      const tecnico = impresora.Tecnico || 'Sin asignar';

      if (!porTecnico.has(tecnico)) {
        porTecnico.set(tecnico, {
          tecnico,
          impresionesBN: 0,
          impresionesColor: 0,
          rentaFija: 0,
          costoExtra: 0,
          precioBN: null,
          precioColor: null
        });
      }

      const grupo = porTecnico.get(tecnico);
      const delta = deltaMap.get(impresora.Serie);
      grupo.impresionesBN += delta?.deltaBN || 0;
      grupo.impresionesColor += delta?.deltaColor || 0;
      grupo.rentaFija += Number(impresora.RentaFija) || 0;
      grupo.costoExtra += Number(impresora.CostoExtra) || 0;
      if (grupo.precioBN === null && impresora.PrecioBN) grupo.precioBN = Number(impresora.PrecioBN);
      if (grupo.precioColor === null && impresora.PrecioColor) grupo.precioColor = Number(impresora.PrecioColor);
    }

    // 5. Crear un ContadoresCierres por técnico
    const cierresCreados = [];
    for (const [, grupo] of porTecnico) {
      const cierre = await prisma.contadoresCierres.create({
        data: {
          ClienteNombre: clienteNombre,
          Tecnico: grupo.tecnico,
          ImpresionesBN: grupo.impresionesBN,
          ImpresionesColor: grupo.impresionesColor,
          TotalImpresiones: grupo.impresionesBN + grupo.impresionesColor,
          RentaFija: grupo.rentaFija || null,
          CostoExtra: grupo.costoExtra || null,
          PrecioBN: grupo.precioBN,
          PrecioColor: grupo.precioColor,
          ComentarioId: comentarioId || null
        },
        include: { comentario: true }
      });
      cierresCreados.push(cierre);
    }

    // 6. Marcar escaneos pendientes como Reportado (si los hay)
    if (pendientes.length > 0) {
      await prisma.contadores.updateMany({
        where: { Cliente: clienteNombre, Estatus: null },
        data: { Estatus: 'Reportado' }
      });
    }

    logger.info(`Cierre formal completado para ${clienteNombre}: ${cierresCreados.length} cierres, ${pendientes.length} escaneos marcados`);
    return cierresCreados;
  }
}
