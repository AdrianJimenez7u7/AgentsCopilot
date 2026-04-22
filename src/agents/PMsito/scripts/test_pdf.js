import { generatePdfReport } from '../services/pdf.service.js';

const testData = [
  { Grupo: 'Implementación', Tarea: 'Zona de aterrizaje', porcentaje_100: 100, nivel_tarea: 1, posicion: 1 },
  { Grupo: 'Implementación', Tarea: 'Despliegue y configuración Azure Site Recovery', porcentaje_100: 100, nivel_tarea: 2, posicion: 2 },
  { Grupo: 'Implementación', Tarea: 'Replicación Azure Site Recovery (ASR)', porcentaje_100: 80, nivel_tarea: 2, posicion: 3 },
  { Grupo: 'Pruebas de Failover', Tarea: 'Test Fail Over', porcentaje_100: 50, nivel_tarea: 1, posicion: 4 },
  { Grupo: 'Pruebas de Failover', Tarea: 'Fail Over Controlado', porcentaje_100: 0, nivel_tarea: 1, posicion: 5 },
  { Grupo: 'Conectividad DNS', Tarea: 'Configurar DNS', porcentaje_100: 100, nivel_tarea: 1, posicion: 6 },
  { Grupo: 'Conectividad DNS', Tarea: 'VPN Point to Site', porcentaje_100: 100, nivel_tarea: 2, posicion: 7 },
  { Grupo: 'Conectividad DNS', Tarea: 'Conexión Site to Site', porcentaje_100: 60, nivel_tarea: 2, posicion: 8 },
  { Grupo: 'Validación', Tarea: 'Servicios Críticos (SQL, RDS, DC)', porcentaje_100: 0, nivel_tarea: 1, posicion: 9 },
  { Grupo: 'Validación', Tarea: 'Integraciones Externas y Endpoints', porcentaje_100: 0, nivel_tarea: 1, posicion: 10 },
];

async function main() {
  try {
    const result = await generatePdfReport(testData, 'test_report', 'bar', 'Reporte de Avances Azure DRP — Química SONS');
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

main();
