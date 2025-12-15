import { ReportService } from '../src/agents/contadores/services/report.service.js';

const sampleData = [
  { datos: { Modelo: 'E52645', TipoImpresion: 'CARTA', Ip: '164.4.145.48', Serie: 'MXBCR581JG', Ubicacion: 'MXTJPR0009', Impresiones: '10424', ImpresionesColor: '0' } },
  { datos: { Modelo: '1PS54A', TipoImpresion: 'CARTA', Ip: '164.4.145.49', Serie: 'MXBCR581JX', Ubicacion: 'MXTJPR0006', Impresiones: '11565', ImpresionesColor: '0' } },
  { datos: { Modelo: '5QJ90A', TipoImpresion: 'CARTA', Ip: '164.4.145.47', Serie: 'MXBCRD3051', Ubicacion: 'MXTJPR0008', Impresiones: '16520', ImpresionesColor: '16937' } },
  { datos: { Modelo: '5QJ90A', TipoImpresion: 'CARTA', Ip: '164.4.145.42', Serie: 'CNC1M4P0DP', Ubicacion: 'MXTJPR0007', Impresiones: '11974', ImpresionesColor: '12908' } }
];

(async () => {
  try {
    const outPath = await ReportService.generateReport(sampleData, 'test_input.xlsx');
    console.log('Reporte generado en:', outPath);
  } catch (err) {
    console.error('Error generando reporte de prueba:', err);
    process.exitCode = 1;
  }
})();
