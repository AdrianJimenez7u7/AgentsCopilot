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
}