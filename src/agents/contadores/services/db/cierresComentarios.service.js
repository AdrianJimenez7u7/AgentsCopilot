import { prisma } from '../../../../shared/prisma/client.js';

export class CierresComentariosService {
  static async obtenerTodos({ clienteNombre, tecnico } = {}) {
    const where = {};
    if (clienteNombre) where.ClienteNombre = { contains: clienteNombre };
    if (tecnico) where.Tecnico = { contains: tecnico };

    return prisma.contadoresCierresComentarios.findMany({
      where,
      orderBy: { FechaCreacion: 'desc' }
    });
  }

  static async obtenerPorId(id) {
    return prisma.contadoresCierresComentarios.findUnique({
      where: { id }
    });
  }

  static async crear(data) {
    return prisma.contadoresCierresComentarios.create({
      data: {
        comentario: data.comentario ?? null,
        ClienteNombre: data.ClienteNombre ?? null,
        Tecnico: data.Tecnico ?? null
      }
    });
  }

  static async actualizar(id, data) {
    return prisma.contadoresCierresComentarios.update({
      where: { id },
      data: {
        comentario: data.comentario ?? null,
        ClienteNombre: data.ClienteNombre ?? null,
        Tecnico: data.Tecnico ?? null
      }
    });
  }

  static async eliminar(id) {
    return prisma.contadoresCierresComentarios.delete({
      where: { id }
    });
  }
}
