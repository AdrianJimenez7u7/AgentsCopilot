import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ImageModule from 'docxtemplater-image-module-free';
import QuickChart from 'quickchart-js';

// 1) Generar PNG del gráfico (Chart.js headless)
async function buildChartPng({ categories, series, chartType }) {
  const width = 900, height = 420;
  const type = String(chartType ?? 'bar').toLowerCase();

  // Construir configuración compatible con Chart.js (QuickChart usa la misma estructura)
  let configuration;
  if (type === 'pie' || type === 'doughnut') {
    const dataValues = series && series.length ? series[0].data : [];
    const backgroundColor = ['#4CAF50', '#F44336', '#2196F3', '#FFC107', '#9C27B0', '#00BCD4', '#FF9800', '#8BC34A'];
    configuration = {
      type: type === 'doughnut' ? 'doughnut' : 'pie',
      data: {
        labels: categories,
        datasets: [{
          label: series && series[0] ? series[0].name ?? 'Datos' : 'Datos',
          data: dataValues,
          backgroundColor: backgroundColor.slice(0, Math.max(categories.length, 1)),
        }]
      },
      options: { responsive: false, plugins: { legend: { position: 'right' }, title: { display: false } } }
    };
  } else {
    configuration = {
      type: 'bar',
      data: {
        labels: categories,
        datasets: series.map((s, idx) => ({
          label: s.name ?? `Serie ${idx + 1}`,
          data: s.data ?? []
        }))
      },
      options: {
        responsive: false,
        plugins: { legend: { display: true }, title: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    };
  }

  // QuickChart: sin dependencias nativas, devuelve Buffer con toBinary()
  const qc = new QuickChart();
  qc.setConfig(configuration).setWidth(width).setHeight(height).setBackgroundColor('transparent');
  const buffer = await qc.toBinary();
  return buffer;
}

export async function generateDocxReport(data, templateName, outputName = `reporte_${Date.now()}`, chartType = 'bar') {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // --- prepara datos para el gráfico (usa tu mismo cálculo) ---
  const groupsMap = data.reduce((acc, t) => {
    const g = String(t.Grupo ?? 'Sin grupo');
    (acc[g] ||= []).push(t);
    return acc;
  }, {});
  const groups = Object.entries(groupsMap).map(([grupo, tasks]) => {
    const tareas = tasks.map((t, i) => {
      const v = Number(t.porcentaje_100 ?? t.porcentaje ?? 0);
      const Estado = v === 100 ? 'Completado' : v === 0 ? 'Sin iniciar' : v > 0 && v < 100 ? 'En proceso' : 'Sin datos';
      return { index: i + 1, Tarea: t.Tarea ?? '', Estado, porcentaje: t.porcentaje ?? '-', porcentaje_100: t.porcentaje_100 ?? '-' };
    });
    return { grupo, count: tasks.length, tareas };
  });
  const total = data.length;
  // calcular conteos por estado: Completado, En proceso, Sin iniciar
  const counts = groups.reduce((acc, g) => {
    g.tareas.forEach(t => {
      if (t.Estado === 'Completado') acc.completed++;
      else if (t.Estado === 'En proceso') acc.inProgress++;
      else if (t.Estado === 'Sin iniciar') acc.notStarted++;
    });
    return acc;
  }, { completed: 0, inProgress: 0, notStarted: 0 });
  const chartData = {
    categories: ['Completado', 'En proceso', 'Sin iniciar'],
    series: [{ name: 'Tareas', data: [counts.completed, counts.inProgress, counts.notStarted] }],
    chartType,
  };

  // --- genera PNG ---
  const chartPng = await buildChartPng(chartData);

  // Guardar PNG temporalmente y pasar la ruta al ImageModule (evita pasar Buffer directo)
  const outDir = path.join(__dirname, '../output');
  fs.mkdirSync(outDir, { recursive: true });
  const chartPath = path.join(outDir, `${outputName}_chart.png`);
  fs.writeFileSync(chartPath, chartPng);

  // --- image module gratis ---
  const imageModule = new ImageModule({
    // tagValue puede ser ruta (string) o Buffer; devolver siempre Buffer
    getImage: function (tagValue /*, tagName */) {
      if (!tagValue) throw new Error('tagValue vacío en imageModule');
      if (Buffer.isBuffer(tagValue)) return tagValue;
      if (typeof tagValue === 'string' && fs.existsSync(tagValue)) return fs.readFileSync(tagValue);
      throw new Error('ImageModule: tagValue no es ruta válida ni Buffer: ' + String(tagValue));
    },
    // tamaño aproximado en px (ajusta si hace falta)
    getSize: function (img /*, tagValue, tagName */) {
      return [600, 280];
    },
  });

  // --- render docx ---
  const templatePath = path.join(__dirname, `../data/${templateName}.docx`);
  const zip = new PizZip(fs.readFileSync(templatePath, 'binary'));
  const doc = new Docxtemplater(zip, { modules: [imageModule], paragraphLoop: true, linebreaks: true });

  const context = {
    proyecto: 'Trupper',
    fecha: new Date().toLocaleDateString('es-ES'),
    groups,
    // pasar la RUTA al placeholder {chart_img} (imageModule leerá el fichero)
    chart_img: chartPath,
  };

  try {
    doc.render(context);
  } catch (err) {
    // si falla render, sacar error detallado (útil para debug)
    console.error('docxtemplater render error:', err);
    throw err;
  }

  const buf = doc.getZip().generate({ type: 'nodebuffer' });
  // outDir ya fue creado arriba (reutilizar)
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${outputName}.docx`);
  const outChartPath = path.join(outDir, `${outputName}_chart.png`);
  fs.writeFileSync(outPath, buf);
  fs.writeFileSync(outChartPath, chartPng);
  return {outPath , outChartPath};
}
