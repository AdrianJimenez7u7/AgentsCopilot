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
        CostoExtra: data.CostoExtra ?? null,
        Ubicacion: data.Ubicacion ?? null
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
        CostoExtra: data.CostoExtra ?? null,
        Ubicacion: data.Ubicacion ?? null
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

  static async bulkClientesByCSV(csv) {
    const lines = csv.trim().split('\n');
    // Eliminar encabezado
    if (lines.length > 0) lines.shift();

    const result = [];

    for (const line of lines) {
      if (!line.trim()) continue;

      const parts = line.split(',').map(p => p.trim());
      // Orden según imagen: Cliente, IP, Modelo, Serie, Ubicacion, Impresiones, BN, Color, PrecioBN, PrecioColor, RentaFija, CostoExtra, Tecnico, FechaLimite
      const [Cliente, IP, Modelo, Serie, Ubicacion, ImpresionesActuales, BN, Color, PrecioBN, PrecioColor, RentaFija, CostoExtra, Tecnico, FechaLimiteReporte] = parts;

      if (!Cliente || !Serie) continue; // Mínimo requerido

      result.push({
        Cliente,
        Modelo: Modelo || "Desconocido",
        Serie,
        IP: IP || null,
        ImpresionesActuales: ImpresionesActuales ? parseInt(ImpresionesActuales) : 0,
        BN: BN ? parseInt(BN) : 0,
        Color: Color ? parseInt(Color) : 0,
        Tecnico: Tecnico || null,
        FechaLimiteReporte: (function () {
          if (!FechaLimiteReporte) return null;
          // Formato esperado DD/MM/YYYY
          if (FechaLimiteReporte.includes('/')) {
            const [day, month, year] = FechaLimiteReporte.split('/');
            if (day && month && year) {
              const d = new Date(year, month - 1, day);
              return isNaN(d.getTime()) ? null : d;
            }
          }
          // Fallback para otros formatos
          const d = new Date(FechaLimiteReporte);
          return isNaN(d.getTime()) ? null : d;
        })(),
        PrecioBN: PrecioBN ? parseFloat(PrecioBN) : 0,
        PrecioColor: PrecioColor ? parseFloat(PrecioColor) : 0,
        RentaFija: RentaFija ? parseFloat(RentaFija) : 0,
        CostoExtra: CostoExtra ? parseFloat(CostoExtra) : 0,
        Ubicacion: Ubicacion ? Ubicacion.substring(0, 50) : null
      });
    }

    if (result.length === 0) return { count: 0 };

    // Batch processing to respect SQL Server 2100 parameter limit
    const BATCH_SIZE = 50;
    let totalCount = 0;

    for (let i = 0; i < result.length; i += BATCH_SIZE) {
      const batch = result.slice(i, i + BATCH_SIZE);
      const batchResult = await prisma.contadoresInfoClientes.createMany({
        data: batch
      });
      totalCount += batchResult.count;
    }

    return { count: totalCount };
  }

  static async getTecnicos() {
    return prisma.contadoresInfoClientes.findMany({
      select: { Tecnico: true },
      where: {
        Tecnico: {
          not: null
        }
      },
      distinct: ['Tecnico']
    });
  }
}