import multer from 'multer';
import XLSX from 'xlsx';
import { prisma } from '../../../shared/prisma/client.js';
import { SapService } from '../services/sap.service.js';
import { SimpliaAgentsService } from '../../../shared/services/simpliaAgents.service.js';


const upload = multer({
  dest: 'src/agents/operaciones/data/',
  limits: { fileSize: 5 * 1024 * 1024 }
});

export class GuiasController {

  static uploadGuias = upload.single('file');

  static async analizarCruce(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Archivo es requerido' });
      }

      const ext = req.file.originalname.toLowerCase();
      if (!ext.endsWith('.xlsx') && !ext.endsWith('.xls') && !ext.endsWith('.csv')) {
        return res.status(400).json({ error: 'Formato debe ser .xlsx, .xls o .csv' });
      }

      const workbook = XLSX.readFile(req.file.path);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (!rows.length) {
        return res.status(400).json({ error: 'El archivo no contiene datos' });
      }

      // Extraer filas válidas y guías únicas para búsquedas en batch
      const filas = rows
        .map(row => ({
          guia: String(row.GUIA || '').trim(),
          referencia1: String(row.REFERENCIA_1 || '').trim(),
          referencia2: String(row.REFERENCIA_2 || '').trim(),
          raw: row
        }))
        .filter(f => f.guia);

      const todasLasGuias = [...new Set(filas.map(f => f.guia))];

      // Buscar en BD, SAP y usuarios de Simplia en paralelo para todas las guías
      const [guiasEnBD, resultadosSAP, usuariosSimplia] = await Promise.all([
        prisma.guiasEnvio.findMany({
          where: { numeroGuia: { in: todasLasGuias }, deleted: false },
          include: { envio: { include: { paqueteria: true } } }
        }),
        SapService.getTrackingInfoBatch(todasLasGuias).catch(err => {
          console.error('Error al consultar SAP:', err.message);
          return [];
        }),
        SimpliaAgentsService.getUsuariosPorCorreoMap().catch(err => {
          console.error('Error al consultar usuarios de Simplia:', err.message);
          return new Map();
        })
      ]);

      const mapBD = new Map(guiasEnBD.map(g => [g.numeroGuia, g]));
      const mapSAP = new Map(resultadosSAP.map(r => [r.guia, r]));

      // 3. Construir resultados fila por fila
      const resultados = filas.map(({ guia, referencia1, referencia2, raw }) => {
        const guiaEnvio = mapBD.get(guia);

        if (guiaEnvio) {
          const dbUnidadNegocio = (guiaEnvio.envio?.unidadNegocio || '').trim();
          const dbUsuario = (guiaEnvio.envio?.usuario || '').trim();
          const paqueteria = guiaEnvio.envio?.paqueteria?.nombre || null;
          const sap = mapSAP.get(guia);

          // envio.usuario es el correo del solicitante; resolvemos su nombre en Simplia.
          const infoSolicitante = dbUsuario ? usuariosSimplia.get(dbUsuario.toLowerCase()) : null;

          return {
            ...raw,
            fuente: 'BD',
            encontrado: true,
            referencia1_excel: referencia1,
            referencia2_excel: referencia2,
            unidadNegocio_db: dbUnidadNegocio,
            solicitante_db: dbUsuario,
            solicitante_nombre_db: infoSolicitante?.nombre ?? null,
            solicitante_email_db: dbUsuario || null,
            paqueteria,
            coinciden: {
              unidadNegocio: referencia1.toLowerCase() === dbUnidadNegocio.toLowerCase(),
              solicitante: referencia2.toLowerCase() === dbUsuario.toLowerCase()
            },
            datosSAP: sap?.success ? {
              tipoOperacion: sap.tipoOperacion,
              cliente: sap.clienteOProveedor ?? null,
              solicitante: sap.solicitante ?? null,
              solicitanteUsuario: sap.solicitanteUsuario ?? null,
              solicitanteEmail: sap.solicitanteEmail ?? null,
              unidadNegocio: sap.unidadNegocio ?? null,
              paqueteria: sap.paqueteria ?? null,
              folioDocumento: sap.folioDocumento ?? null,
              estatus: sap.estatus ?? null,
              comentariosRPA: sap.comentariosRPA ?? null
            } : null
          };
        }

        const sap = mapSAP.get(guia);
        if (sap?.success) {
          return {
            ...raw,
            fuente: 'SAP',
            encontrado: true,
            referencia1_excel: referencia1,
            referencia2_excel: referencia2,
            // Sin registro en BD: la unidad de negocio viene de SAP→Simplia (solicitanteEmail)
            unidadNegocio_db: sap.unidadNegocio ?? null,
            solicitante_db: sap.solicitante ?? null,
            solicitante_nombre_db: null,
            solicitante_email_db: null,
            paqueteria: sap.paqueteria ?? null,
            coinciden: {
              unidadNegocio: !!sap.unidadNegocio &&
                referencia1.toLowerCase() === sap.unidadNegocio.toLowerCase()
            },
            datosSAP: {
              tipoOperacion: sap.tipoOperacion,
              cliente: sap.clienteOProveedor ?? null,
              solicitante: sap.solicitante ?? null,
              solicitanteUsuario: sap.solicitanteUsuario ?? null,
              solicitanteEmail: sap.solicitanteEmail ?? null,
              unidadNegocio: sap.unidadNegocio ?? null,
              paqueteria: sap.paqueteria ?? null,
              folioDocumento: sap.folioDocumento ?? null,
              estatus: sap.estatus ?? null,
              comentariosRPA: sap.comentariosRPA ?? null
            }
          };
        }

        return {
          ...raw,
          fuente: null,
          encontrado: false,
          referencia1_excel: referencia1,
          referencia2_excel: referencia2,
          unidadNegocio_db: null,
          solicitante_db: null,
          solicitante_nombre_db: null,
          solicitante_email_db: null,
          paqueteria: null,
          coinciden: null
        };
      });

      const conCoincidencia = resultados.filter(r => r.encontrado);
      const sinCoincidencia = resultados.filter(r => !r.encontrado);
      const unidadNegocioOk = conCoincidencia.filter(r => r.coinciden?.unidadNegocio).length;
      const solicitanteOk = conCoincidencia.filter(r => r.coinciden?.solicitante).length;

      return res.status(200).json({
        totalGuias: resultados.length,
        encontradas: conCoincidencia.length,
        noEncontradas: sinCoincidencia.length,
        encontradasEnBD: resultados.filter(r => r.fuente === 'BD').length,
        encontradasEnSAP: resultados.filter(r => r.fuente === 'SAP').length,
        coincidenUnidadNegocio: unidadNegocioOk,
        coincidenSolicitante: solicitanteOk,
        detalle: resultados
      });

    } catch (error) {
      console.error('Error en analizarCruce:', error);
      return res.status(500).json({ error: 'Error procesando el archivo', detalle: error.message });
    }
  }
}
