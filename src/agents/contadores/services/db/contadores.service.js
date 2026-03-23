import { prisma } from '../../../../shared/prisma/client.js';

export class ContadoresService {
  static async obtenerReportesFaltantes() {
    return prisma.contadores.findMany({
      where: {
        OR: [
          { Estatus: null },
          { Estatus: '' }
        ]
      }
    });
  }

  static async obtenerEscaneosFaltantes() {
    const now = new Date();
    const inicio = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), -11, 0, 0, 0, 0));
    const fin = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    return prisma.contadoresInfoClientes.findMany({
      where: {
        FechaLimiteReporte: {
          gte: inicio,
          lte: fin
        }
      }
    });
  }

  static async alertarReportesFaltantes() {
    const reportesFaltantes = await this.obtenerReportesFaltantes();

    const items = reportesFaltantes.map((reporte) => {
      const fecha = reporte.FechaCaptura
        ? new Date(reporte.FechaCaptura).toISOString()
        : '-';
      const total = reporte.TotalImpresiones ?? reporte.ImpresionesActuales ?? '0';

      return `
        {
          "type": "ColumnSet",
          "separator": true,
          "spacing": "Medium",
          "columns": [
            {
              "type": "Column",
              "width": "auto",
              "items": [
                {
                  "type": "Image",
                  "url": "https://img.icons8.com/ios-filled/50/737373/print.png",
                  "size": "Small",
                  "altText": "Icono Impresora"
                }
              ],
              "verticalContentAlignment": "Center"
            },
            {
              "type": "Column",
              "width": "stretch",
              "items": [
                {
                  "type": "TextBlock",
                  "text": "${reporte.Cliente ?? '-'}",
                  "weight": "Bolder",
                  "size": "Medium",
                  "wrap": true
                },
                {
                  "type": "FactSet",
                  "facts": [
                    { "title": "Serie:", "value": "${reporte.Serie ?? '-'}" },
                    { "title": "Fecha Captura:", "value": "${fecha}" }
                  ]
                }
              ]
            },
            {
              "type": "Column",
              "width": "auto",
              "items": [
                {
                  "type": "TextBlock",
                  "text": "${total}",
                  "weight": "Bolder",
                  "size": "Large",
                  "horizontalAlignment": "Right",
                  "color": "good"
                },
                {
                  "type": "TextBlock",
                  "text": "Impresiones",
                  "size": "Small",
                  "horizontalAlignment": "Right",
                  "isSubtle": true,
                  "spacing": "None"
                }
              ],
              "verticalContentAlignment": "Center"
            }
          ]
        }`;
    }).join(',');

    const adaptiveCard = `
    {
      "type": "AdaptiveCard",
      "$schema": "https://adaptivecards.io/schemas/adaptive-card.json",
      "version": "1.5",
      "speak": "Alerta: tienes reportes por generar",
      "body": [
        {
          "type": "Container",
          "style": "emphasis",
          "items": [
            {
              "type": "ColumnSet",
              "columns": [
                {
                  "type": "Column",
                  "width": "auto",
                  "items": [
                    {
                      "type": "Image",
                      "url": "https://img.icons8.com/fluency/96/FA5252/appointment-reminders--v1.png",
                      "size": "Small",
                      "altText": "Icono de Alerta"
                    }
                  ],
                  "verticalContentAlignment": "Center"
                },
                {
                  "type": "Column",
                  "width": "stretch",
                  "items": [
                    { "type": "TextBlock", "text": "ACCIÓN SUGERIDA", "weight": "Bolder", "color": "warning", "size": "Small", "spacing": "None" },
                    { "type": "TextBlock", "text": "Reportes pendientes", "weight": "Bolder", "size": "Large", "spacing": "None" },
                    { "type": "TextBlock", "text": "Conteo de impresiones sin reporte", "isSubtle": true, "spacing": "None", "size": "Small" }
                  ],
                  "verticalContentAlignment": "Center"
                }
              ]
            }
          ],
          "bleed": true
        },
        {
          "type": "TextBlock",
          "text": "CLIENTES",
          "weight": "Bolder",
          "size": "Medium",
          "isSubtle": true,
          "spacing": "Large"
        }
        ${items ? ',' + items : ''}
      ],
      "actions": [
        {
          "type": "Action.OpenUrl",
          "title": "📋 Ver Lista Completa",
          "url": "https://tudominio.com/impresoras"
        }
      ]
    }`;

    return adaptiveCard;
  }


  static async alertarEscaneosFaltantes() {
    const escaneosFaltantes = await this.obtenerEscaneosFaltantes();

    const MAX_ITEMS = 20;
    const totalFaltantes = escaneosFaltantes.length;
    const itemsToShow = escaneosFaltantes.slice(0, MAX_ITEMS);

    const items = itemsToShow.map((escaneo) => {
      // Formato de fecha corto y limpio (ej: "29 DIC")
      let fechaFormatted = 'Pendiente';
      if (escaneo.FechaLimiteReporte) {
        fechaFormatted = new Date(escaneo.FechaLimiteReporte)
          .toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
          .toUpperCase();
      }

      return `
        {
          "type": "ColumnSet",
          "spacing": "Large",
          "columns": [
            {
              "type": "Column",
              "width": "stretch",
              "items": [
                {
                  "type": "TextBlock",
                  "text": "${escaneo.Cliente ?? 'Cliente Desconocido'}",
                  "weight": "Bolder",
                  "size": "Medium",
                  "wrap": true
                },
                {
                 "type": "TextBlock",
                 "text": "S/N: ${escaneo.Serie ?? '-'} • ${escaneo.Ubicacion ?? 'Sin ubicación'}",
                 "isSubtle": true,
                 "size": "Small",
                 "wrap": true,
                 "spacing": "Small"
                }
              ]
            },
            {
              "type": "Column",
              "width": "auto",
              "verticalContentAlignment": "Center",
              "items": [
                {
                  "type": "TextBlock",
                  "text": "${fechaFormatted}",
                  "color": "attention",
                  "weight": "Bolder",
                  "size": "Medium",
                  "horizontalAlignment": "Right"
                },
                {
                  "type": "TextBlock",
                  "text": "Límite",
                  "isSubtle": true,
                  "size": "Small",
                  "horizontalAlignment": "Right",
                  "spacing": "None"
                }
              ]
            }
          ]
        }`;
    }).join(',');

    let footerMessage = '';
    if (totalFaltantes > MAX_ITEMS) {
      const remaining = totalFaltantes - MAX_ITEMS;
      footerMessage = `,
        {
           "type": "TextBlock",
           "text": "Y quedan otros **${remaining}** pendientes más.",
           "wrap": true,
           "spacing": "Large",
           "separator": true,
           "size": "Medium"
        }`;
    }

    // Si no hay items, mostramos un mensaje sutil.
    const bodyItems = items ? (items + footerMessage) : `
    {
       "type": "TextBlock",
       "text": "✅ Todo al día. No faltan escaneos.",
       "isSubtle": true,
       "horizontalAlignment": "Center",
       "spacing": "ExtraLarge"
    }`;


    const adaptiveCard = `
    {
      "type": "AdaptiveCard",
      "$schema": "https://adaptivecards.io/schemas/adaptive-card.json",
      "version": "1.5",
      "body": [
        {
          "type": "TextBlock",
          "text": "Escaneos Faltantes",
          "size": "ExtraLarge",
          "weight": "Bolder",
          "color": "accent"
        },
        {
          "type": "TextBlock",
          "text": "Se requiere la lectura de los siguientes equipos.",
          "isSubtle": true,
          "spacing": "Small",
          "size": "Medium"
        },
        {
            "type": "Container",
            "spacing": "ExtraLarge",
            "items": [
                ${bodyItems}
            ]
        }
      ],
      "actions": [
        {
          "type": "Action.OpenUrl",
          "title": "Gestionar Escaneos",
          "url": "https://innofront-b4htgzhdb2gxe0ga.southcentralus-01.azurewebsites.net/contadores/escaneos/",
          "style": "positive"
        }
      ]
    }`;

    return adaptiveCard;
  }

  static async validateAllExistReportsStateNull() {
    const pendingCount = await prisma.contadores.count({
      where: {
        OR: [
          { Estatus: null },
          { Estatus: '' },
          { Estatus: ' ' }
        ]
      }
    });

    return pendingCount > 0;
  }

  static async obtenerContadoresPorFecha(fechaInicio, fechaFin) {
    return prisma.contadores.findMany({
      where: {
        FechaCaptura: {
          gte: new Date(fechaInicio),
          lt: new Date(fechaFin)
        }
      }
    });
  }

  static async alertarEscaneosFaltantesPorTecnico(tecnico) {
    const now = new Date();
    // Fecha limite = Hoy + 7 dias. (Buscamos todo lo que venza antes de eso)
    const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);

    const escaneosFaltantes = await prisma.contadoresInfoClientes.findMany({
      where: {
        Tecnico: { contains: tecnico }, // Busqueda laxa por nombre
        FechaLimiteReporte: {
          lte: targetDate
        }
      }
    });

    const MAX_ITEMS = 10;
    const totalFaltantes = escaneosFaltantes.length;
    const itemsToShow = escaneosFaltantes.slice(0, MAX_ITEMS);

    const items = itemsToShow.map((escaneo) => {
      // Formato de fecha corto (ej: "29 DIC")
      let fechaFormatted = 'Pendiente';
      let isOverdue = false;
      if (escaneo.FechaLimiteReporte) {
        const fechaLimite = new Date(escaneo.FechaLimiteReporte);
        fechaFormatted = fechaLimite
          .toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
          .toUpperCase();

        if (fechaLimite < now) {
          isOverdue = true;
        }
      }

      return `
        {
          "type": "ColumnSet",
          "spacing": "Medium", 
          "columns": [
            {
              "type": "Column",
              "width": "stretch",
              "items": [
                {
                  "type": "TextBlock",
                  "text": "${escaneo.Cliente ?? 'Cliente Desconocido'}",
                  "weight": "Bolder",
                  "size": "Medium",
                  "wrap": true
                },
                {
                 "type": "TextBlock",
                 "text": "${escaneo.Modelo ?? ''} (${escaneo.Serie ?? '-'})",
                 "isSubtle": true,
                 "size": "Small",
                 "wrap": true,
                 "spacing": "None"
                }
              ]
            },
            {
              "type": "Column",
              "width": "auto",
              "verticalContentAlignment": "Center",
              "items": [
                {
                  "type": "TextBlock",
                  "text": "${fechaFormatted}",
                  "color": "${isOverdue ? 'attention' : 'warning'}",
                  "weight": "Bolder",
                  "size": "Medium",
                  "horizontalAlignment": "Right"
                },
                {
                  "type": "TextBlock",
                  "text": "${isOverdue ? 'Vencido' : 'Próximo'}",
                  "isSubtle": true,
                  "size": "Small",
                  "horizontalAlignment": "Right",
                  "spacing": "None"
                }
              ]
            }
          ]
        }`;
    }).join(',');

    let footerMessage = '';
    if (totalFaltantes > MAX_ITEMS) {
      const remaining = totalFaltantes - MAX_ITEMS;
      footerMessage = `,
        {
           "type": "TextBlock",
           "text": "Y quedan otros **${remaining}** pendientes más.",
           "wrap": true,
           "spacing": "Large",
           "separator": true,
           "size": "Medium"
        }`;
    }

    // Si no hay items, mostramos un mensaje sutil.
    const bodyItems = items ? (items + footerMessage) : `
    {
       "type": "TextBlock",
       "text": "✅ Todo al día. No faltan escaneos para ${tecnico ?? 'este técnico'}.",
       "isSubtle": true,
       "horizontalAlignment": "Center",
       "spacing": "ExtraLarge"
    }`;


    const adaptiveCard = `
    {
      "type": "AdaptiveCard",
      "$schema": "https://adaptivecards.io/schemas/adaptive-card.json",
      "version": "1.5",
      "body": [
        {
          "type": "TextBlock",
          "text": "Escaneos Pendientes (${tecnico})",
          "size": "Large",
          "weight": "Bolder",
          "color": "accent"
        },
        {
            "type": "Container",
            "spacing": "Large",
            "items": [
                ${bodyItems}
            ]
        }
      ]
    }`;

    return adaptiveCard;
  }
}