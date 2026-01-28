import { prisma } from '../../../../shared/prisma/client.js';

export class ClientesService {
  static async obtenerClientes() {
    return prisma.contadoresInfoClientes.findMany({
      orderBy: { Cliente: 'asc' }
    });
  }

  static async obtenerContadores() {
    return prisma.contadores.findMany({
      orderBy: { FechaCaptura: 'desc' }
    });
  }

  static async crearImpresoraCliente(data) {
    return prisma.contadoresInfoClientes.create({
      data: {
        Cliente: data.Cliente,
        Modelo: data.Modelo,
        Serie: data.Serie,
        IP: data.IP ?? null,
        ImpresionesActuales: data.ImpresionesActuales ?? null,
        BN: data.BN ?? null,
        Color: data.Color ?? null,
        Tecnico: data.Tecnico ?? null,
        FechaLimiteReporte: data.FechaLimiteReporte ? new Date(data.FechaLimiteReporte) : null,
        PrecioBN: data.PrecioBN ?? null,
        PrecioColor: data.PrecioColor ?? null,
        RentaFija: data.RentaFija ?? null,
        CostoExtra: data.CostoExtra ?? null
      }
    });
  }

  static async actualizarImpresoraCliente(id, data) {
    return prisma.contadoresInfoClientes.update({
      where: { id },
      data: {
        Cliente: data.Cliente,
        Modelo: data.Modelo,
        Serie: data.Serie,
        IP: data.IP ?? null,
        ImpresionesActuales: data.ImpresionesActuales ?? null,
        BN: data.BN ?? null,
        Color: data.Color ?? null,
        Tecnico: data.Tecnico ?? null,
        FechaLimiteReporte: data.FechaLimiteReporte ? new Date(data.FechaLimiteReporte) : null,
        PrecioBN: data.PrecioBN ?? null,
        PrecioColor: data.PrecioColor ?? null,
        RentaFija: data.RentaFija ?? null,
        CostoExtra: data.CostoExtra ?? null
      }
    });
  }

  static async obtenerEscaneosFaltantes() {
    const now = new Date();
    const inicio = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), -11, 0, 0, 0, 0));
    const fin = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));

    const clientes = await prisma.contadoresInfoClientes.findMany({
      where: { FechaLimiteReporte: { gte: inicio, lte: fin } }
    });

    if (!clientes.length) return [];

    const capturas = await prisma.contadores.findMany({
      where: {
        Cliente: { in: clientes.map(c => c.Cliente) },
        FechaCaptura: {
          gte: inicio,
          lte: fin
        }
      },
      select: { Cliente: true }
    });

    const conCaptura = new Set(capturas.map(c => c.Cliente));
    return clientes.filter(c => !conCaptura.has(c.Cliente));
  }
  static async deleteCliente(id) {
    return prisma.contadoresInfoClientes.delete({ where: { id } });
  }
}