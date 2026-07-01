import { prisma } from '../../../../shared/prisma/client.js';

export class CierreFacturacionService {
  static async obtenerTodos({ clienteNombre, tecnicoResponsable } = {}) {
    const where = {};
    if (clienteNombre) where.ClienteNombre = { contains: clienteNombre };
    if (tecnicoResponsable) where.TecnicoResponsable = { contains: tecnicoResponsable };

    return prisma.cotandoresCierreFacturacion.findMany({
      where,
      orderBy: { FechaCierreFacturacion: 'desc' }
    });
  }

  static async obtenerPorId(id) {
    return prisma.cotandoresCierreFacturacion.findUnique({ where: { id } });
  }

  static async crear(data) {
    return prisma.cotandoresCierreFacturacion.create({
      data: {
        ClienteNombre: data.ClienteNombre ?? null,
        TecnicoResponsable: data.TecnicoResponsable ?? null
      }
    });
  }

  static async eliminar(id) {
    return prisma.cotandoresCierreFacturacion.delete({ where: { id } });
  }
}
