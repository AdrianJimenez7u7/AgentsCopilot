// reportes/generarDocxConGrafica.js
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ImageModule from 'docxtemplater-image-module-free';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import * as NapiCanvas from '@napi-rs/canvas';

// (Opcional) registra fuentes para que ChartJS tenga tipografías en el PNG
// Asegúrate de tener el archivo si activas esto.
// NapiCanvas.GlobalFonts.registerFromPath('./assets/Roboto-Regular.ttf', 'Roboto');

// --- Factoria del renderer de Chart.js con @napi-rs/canvas inyectado ---
function createChartRenderer({ width, height, backgroundColour = 'white' } = {}) {
  return new ChartJSNodeCanvas({
    width,
    height,
    backgroundColour,
    devicePixelRatio: 1,
    // 👇 clave: implementación N-API portable
    canvas: {
      createCanvas: NapiCanvas.createCanvas,
      loadImage: NapiCanvas.loadImage,
      Image: NapiCanvas.Image,
      GlobalFonts: NapiCanvas.GlobalFonts,
    },
  });
}

// 1) Generar PNG del gráfico (Chart.js headless)
export async function buildChartPng({ categories, series, chartType }) {
  const width = 900, height = 420;
  const canvas = createChartRenderer({ width, height, backgroundColour: 'white' });

  const type = String(chartType ?? 'bar').toLowerCase();
  let configuration;

  if (type === 'pie' || type === 'doughnut') {
    const dataValues = series && series.length ? series[0].data : [];
    const backgroundColor = [
      '#4CAF50', '#F44336', '#2196F3', '#FFC107',
      '#9C27B0', '#00BCD4', '#FF9800', '#8BC34A'
    ];
    configuration = {
      type: type === 'doughnut' ? 'doughnut' : 'pie',
      data: {
        labels: categories,
        datasets: [{
          label: series[0]?.name ?? 'Datos',
          data: dataValues,
          backgroundColor: backgroundColor.slice(0, categories.length)
        }]
      },
      options: {
        responsive: false,
        plugins: {
          legend: { position: 'right' },
          title: { display: false }
        }
      },
    };
  } else {
    configuration = {
      type: 'bar', // puedes cambiar a 'line' si Topic.TipoChartString = 'line'
      data: {
        labels: categories,
        datasets: (series ?? []).map((s, idx) => ({
          label: s?.name ?? `Serie ${idx + 1}`,
          data: s?.data ?? [],
          // Sin colores específicos para mantenerlo simple/portable
        }))
      },
      options: {
        responsive: false,
        plugins: {
          legend: { display: true },
          title: { display: false }
        },
        scales: {
          y: { beginAtZero: true }
        }
      },
    };
  }

  // retorna Buffer PNG
  return await canvas.renderToBuffer(configuration, 'image/png');
}

// 2) Generar el DOCX con la gráfica embebida
export async function generateDocxReport(
  data,                 // arreglo de tareas {Tarea, Grupo, porcentaje, porcentaje_100, ...}
  templateName,         // nombre del .docx en /data (sin extensión)
  outputName = `reporte_${Date.now()}`,
  chartType = 'bar'     // 'bar' | 'pie' | 'doughnut' | 'line'
) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  // --- agrupar y normalizar datos para la tabla/estados ---
  const groupsMap = data.reduce((acc, t) => {
    const g = String(t.Grupo ?? 'Sin grupo');
    (acc[g] ||= []).push(t);
    return acc;
  }, {});

  const groups = Object.entries(groupsMap).map(([grupo, tasks]) => {
    const tareas = tasks.map((t, i) => {
      const v100 = Number(
        t.porcentaje_100 ??
        (typeof t.porcentaje === 'number' ? t.porcentaje * 100 : 0)
      );
      const Estado =
        v100 === 100 ? 'Completado' :
        v100 === 0   ? 'Sin iniciar' :
        v100 > 0 && v100 < 100 ? 'En proceso' : 'Sin datos';

      return {
        index: i + 1,
        Tarea: t.Tarea ?? '',
        Estado,
        porcentaje: t.porcentaje ?? '-',        // (0-1) si viene así, se muestra tal cual
        porcentaje_100: v100                    // 0-100
      };
    });
    return { grupo, count: tasks.length, tareas };
  });

  // --- conteos para gráfica rápida por estado ---
  const counts = groups.reduce(
    (acc, g) => {
      for (const t of g.tareas) {
        if (t.Estado === 'Completado') acc.completed++;
        else if (t.Estado === 'En proceso') acc.inProgress++;
        else if (t.Estado === 'Sin iniciar') acc.notStarted++;
      }
      return acc;
    },
    { completed: 0, inProgress: 0, notStarted: 0 }
  );

  const chartData = {
    categories: ['Completado', 'En proceso', 'Sin iniciar'],
    series: [{ name: 'Tareas', data: [counts.completed, counts.inProgress, counts.notStarted] }],
    chartType,
  };

  // --- genera PNG ---
  const chartPng = await buildChartPng(chartData);

  // Guardar PNG temporalmente y pasar la ruta al ImageModule
  const outDir = path.join(__dirname, '../output');
  fs.mkdirSync(outDir, { recursive: true });
  const chartPath = path.join(outDir, `${outputName}_chart.png`);
  fs.writeFileSync(chartPath, chartPng);

  // --- configurar image module ---
  const imageModule = new ImageModule({
    // Devuelve siempre Buffer; si llega ruta, léela.
    getImage: function (tagValue /*, tagName */) {
      if (!tagValue) throw new Error('tagValue vacío en imageModule');
      if (Buffer.isBuffer(tagValue)) return tagValue;
      if (typeof tagValue === 'string' && fs.existsSync(tagValue)) {
        return fs.readFileSync(tagValue);
      }
      throw new Error('ImageModule: tagValue no es ruta válida ni Buffer: ' + String(tagValue));
    },
    // tamaño aproximado en px dentro del DOCX
    getSize: function (img /*, tagValue, tagName */) {
      return [600, 280];
    },
  });

  // --- render docx desde plantilla ---
  const templatePath = path.join(__dirname, `../data/${templateName}.docx`);
  const zip = new PizZip(fs.readFileSync(templatePath, 'binary'));
  const doc = new Docxtemplater(zip, {
    modules: [imageModule],
    paragraphLoop: true,
    linebreaks: true,
  });

  const context = {
    proyecto: 'Trupper',
    fecha: new Date().toLocaleDateString('es-MX'),
    groups,                 // para tus tablas/bucles en docx
    chart_img: chartPath,   // el placeholder de imagen en la plantilla
  };

  try {
    doc.render(context);
  } catch (err) {
    console.error('docxtemplater render error:', err);
    throw err;
  }

  const buf = doc.getZip().generate({ type: 'nodebuffer' });
  const outPath = path.join(outDir, `${outputName}.docx`);
  const outChartPath = path.join(outDir, `${outputName}_chart.png`);
  fs.writeFileSync(outPath, buf);
  fs.writeFileSync(outChartPath, chartPng);

  return { outPath, outChartPath };
}
