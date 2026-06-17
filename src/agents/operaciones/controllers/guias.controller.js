import multer from 'multer';
import XLSX from 'xlsx';
import { prisma } from '../../../shared/prisma/client.js';

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

      const resultados = [];

      for (const row of rows) {
        const guia = String(row.GUIA || '').trim();
        if (!guia) continue;

        const referencia1 = String(row.REFERENCIA_1 || '').trim();
        const referencia2 = String(row.REFERENCIA_2 || '').trim();

        const guiaEnvio = await prisma.guiasEnvio.findFirst({
          where: { numeroGuia: guia, deleted: false },
          include: {
            envio: {
              include: {
                paqueteria: true
              }
            }
          }
        });

        if (!guiaEnvio) {
          resultados.push({
            ...row,
            encontrado: false,
            referencia1_excel: referencia1,
            referencia2_excel: referencia2,
            unidadNegocio_db: null,
            solicitante_db: null,
            paqueteria: null,
            coinciden: null
          });
          continue;
        }

        const dbUnidadNegocio = (guiaEnvio.envio?.unidadNegocio || '').trim();
        const dbUsuario = (guiaEnvio.envio?.usuario || '').trim();
        const paqueteria = guiaEnvio.envio?.paqueteria?.nombre || null;

        resultados.push({
          ...row,
          encontrado: true,
          referencia1_excel: referencia1,
          referencia2_excel: referencia2,
          unidadNegocio_db: dbUnidadNegocio,
          solicitante_db: dbUsuario,
          paqueteria,
          coinciden: {
            unidadNegocio: referencia1.toLowerCase() === dbUnidadNegocio.toLowerCase(),
            solicitante: referencia2.toLowerCase() === dbUsuario.toLowerCase()
          }
        });
      }

      const total = resultados.length;
      const conCoincidencia = resultados.filter(r => r.encontrado);
      const sinCoincidencia = resultados.filter(r => !r.encontrado);
      const unidadNegocioOk = conCoincidencia.filter(r => r.coinciden?.unidadNegocio).length;
      const solicitanteOk = conCoincidencia.filter(r => r.coinciden?.solicitante).length;

      return res.status(200).json({
        totalGuias: total,
        encontradas: conCoincidencia.length,
        noEncontradas: sinCoincidencia.length,
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
