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
}

