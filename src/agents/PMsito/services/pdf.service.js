import PdfPrinter from 'pdfmake';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import QuickChart from 'quickchart-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ──────────────────────────────────────────────
// Tokens de diseño (paleta Compucad)
// ──────────────────────────────────────────────
const COLORS = {
  primary:    '#E87722',   // naranja Compucad
  gold:       '#D4A843',   // dorado
  darkGray:   '#333333',
  medGray:    '#666666',
  lightGray:  '#E0E0E0',
  white:      '#FFFFFF',
  green:      '#4CAF50',
  yellow:     '#FFC107',
  red:        '#F44336',
  headerBg:   '#E87722',
  sectionBg:  '#F5F5F5',
};

// Fonts built-in de pdfmake (no requiere archivos externos)
const fonts = {
  Helvetica: {
    normal:      'Helvetica',
    bold:        'Helvetica-Bold',
    italics:     'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

const printer = new PdfPrinter(fonts);

// ──────────────────────────────────────────────
// Logo Compucad como base64
// ──────────────────────────────────────────────
function getLogoBase64() {
  const logoPath = path.join(__dirname, '../media/Logo-Compucad.png');
  if (!fs.existsSync(logoPath)) return null;
  const buffer = fs.readFileSync(logoPath);
  return 'data:image/png;base64,' + buffer.toString('base64');
}

// ──────────────────────────────────────────────
// Gráfica QuickChart → base64 PNG
// ──────────────────────────────────────────────
async function buildChartBase64({ categories, series, chartType }) {
  const type = String(chartType ?? 'bar').toLowerCase();
  let configuration;

  if (type === 'pie' || type === 'doughnut') {
    const dataValues = series?.[0]?.data ?? [];
    const bgColors = [COLORS.green, COLORS.yellow, COLORS.lightGray, COLORS.red, '#2196F3', '#9C27B0'];
    configuration = {
      type: type === 'doughnut' ? 'doughnut' : 'pie',
      data: {
        labels: categories,
        datasets: [{
          data: dataValues,
          backgroundColor: bgColors.slice(0, Math.max(categories.length, 1)),
        }],
      },
      options: { responsive: false, plugins: { legend: { position: 'right' } } },
    };
  } else {
    configuration = {
      type: 'bar',
      data: {
        labels: categories,
        datasets: series.map((s, i) => ({
          label: s.name ?? `Serie ${i + 1}`,
          data: s.data ?? [],
          backgroundColor: [COLORS.green, COLORS.yellow, COLORS.lightGray][i] ?? COLORS.primary,
        })),
      },
      options: {
        responsive: false,
        plugins: { legend: { display: true } },
        scales: { y: { beginAtZero: true } },
      },
    };
  }

  const qc = new QuickChart();
  qc.setConfig(configuration).setWidth(800).setHeight(400).setBackgroundColor('#FFFFFF');
  const buffer = await qc.toBinary();
  return 'data:image/png;base64,' + buffer.toString('base64');
}

// ──────────────────────────────────────────────
// Helpers de layout
// ──────────────────────────────────────────────

/** Barra horizontal de progreso (usa canvas-like rect de pdfmake) */
function progressBar(percent, width = 200, height = 14) {
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  const color = pct === 100 ? COLORS.green : pct > 0 ? COLORS.yellow : COLORS.lightGray;
  const filledW = Math.round((pct / 100) * width);

  return {
    canvas: [
      // fondo gris
      { type: 'rect', x: 0, y: 0, w: width, h: height, r: 3, color: COLORS.lightGray },
      // relleno
      ...(filledW > 0 ? [{ type: 'rect', x: 0, y: 0, w: filledW, h: height, r: 3, color }] : []),
    ],
    width,
  };
}

/** Etiqueta coloreada (badge) */
function statusBadge(estado) {
  const colorMap = {
    'Completado':  COLORS.green,
    'En proceso':  COLORS.yellow,
    'Sin iniciar': COLORS.lightGray,
  };
  const bg = colorMap[estado] ?? COLORS.lightGray;
  const textColor = estado === 'Sin iniciar' ? COLORS.darkGray : COLORS.white;

  return {
    text: ` ${estado} `,
    fontSize: 8,
    bold: true,
    color: textColor,
    background: bg,
  };
}

/** Header que va en todas las páginas internas */
function pageHeader(logoBase64) {
  return {
    columns: [
      ...(logoBase64 ? [{ image: logoBase64, width: 100, margin: [40, 10, 0, 0] }] : []),
      { text: '', width: '*' },
    ],
    margin: [0, 0, 0, 0],
  };
}

/** Barra naranja superior decorativa */
function orangeBar() {
  return {
    canvas: [
      { type: 'rect', x: 0, y: 0, w: 515, h: 6, color: COLORS.primary },
    ],
    margin: [0, 0, 0, 10],
  };
}

/** Título de sección con fondo naranja */
function sectionTitle(text) {
  return {
    table: {
      widths: ['*'],
      body: [[
        {
          text,
          fontSize: 12,
          bold: true,
          color: COLORS.white,
          fillColor: COLORS.primary,
          margin: [8, 5, 8, 5],
        },
      ]],
    },
    layout: 'noBorders',
    margin: [0, 12, 0, 6],
  };
}

/** Subtítulo de sección con fondo gris */
function subSectionTitle(text) {
  return {
    table: {
      widths: ['*'],
      body: [[
        {
          text,
          fontSize: 10,
          bold: true,
          color: COLORS.darkGray,
          fillColor: COLORS.sectionBg,
          margin: [8, 4, 8, 4],
        },
      ]],
    },
    layout: 'noBorders',
    margin: [0, 6, 0, 4],
  };
}

// ──────────────────────────────────────────────
// Generación del PDF
// ──────────────────────────────────────────────
export async function generatePdfReport(data, outputName = `reporte_${Date.now()}`, chartType = 'bar', nameReport) {
  const logoBase64 = getLogoBase64();

  // ── Preparar datos ──
  const sortedData = Array.isArray(data)
    ? [...data].sort((a, b) => Number(a.posicion ?? a.pos ?? 0) - Number(b.posicion ?? b.pos ?? 0))
    : [];

  const groupsMap = sortedData.reduce((acc, t) => {
    const g = String(t.Grupo ?? 'Sin grupo');
    if (!acc[g]) acc[g] = [];
    acc[g].push(t);
    return acc;
  }, {});

  const groups = Object.entries(groupsMap).map(([grupo, tasks]) => {
    const tareas = tasks.map((t, i) => {
      const v = Number(t.porcentaje_100 ?? t.porcentaje ?? 0);
      const Estado = v === 100 ? 'Completado' : v === 0 ? 'Sin iniciar' : v > 0 && v < 100 ? 'En proceso' : 'Sin datos';
      const nivel = Number(t.nivel_tarea ?? t.nivel ?? 1);
      const indent = '  '.repeat(Math.max(0, nivel - 1));
      return {
        index: i + 1,
        Tarea: t.Tarea ?? '',
        TareaDisplay: `${indent}${t.Tarea ?? ''}`,
        Estado,
        porcentaje: Number(t.porcentaje ?? 0),
        porcentaje_100: Number(t.porcentaje_100 ?? v),
        nivel,
      };
    });
    return { grupo, count: tasks.length, tareas };
  });

  const counts = { completed: 0, inProgress: 0, notStarted: 0 };
  groups.forEach(g => g.tareas.forEach(t => {
    if (t.Estado === 'Completado') counts.completed++;
    else if (t.Estado === 'En proceso') counts.inProgress++;
    else if (t.Estado === 'Sin iniciar') counts.notStarted++;
  }));
  const total = sortedData.length;

  // ── Gráfica ──
  const chartBase64 = await buildChartBase64({
    categories: ['Completado', 'En proceso', 'Sin iniciar'],
    series: [{ name: 'Tareas', data: [counts.completed, counts.inProgress, counts.notStarted] }],
    chartType,
  });

  const fechaHoy = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
  const projectName = nameReport || 'Reporte de Proyecto';

  // ──────────────────────────────────────────
  // PORTADA
  // ──────────────────────────────────────────
  const coverPage = [
    // Barra naranja superior gruesa
    {
      canvas: [
        { type: 'rect', x: 0, y: 0, w: 515, h: 12, color: COLORS.primary },
        { type: 'rect', x: 0, y: 12, w: 515, h: 4, color: COLORS.gold },
      ],
      margin: [0, 0, 0, 30],
    },

    // Logo
    ...(logoBase64 ? [{
      image: logoBase64,
      width: 200,
      alignment: 'left',
      margin: [0, 0, 0, 5],
    }] : []),

    // Subtítulo
    {
      text: 'Infraestructura & Soluciones TI',
      fontSize: 11,
      color: COLORS.medGray,
      margin: [0, 0, 0, 40],
    },

    // Título del reporte
    {
      text: 'Reporte de Avances',
      fontSize: 26,
      bold: true,
      color: COLORS.darkGray,
      margin: [0, 0, 0, 5],
    },
    {
      text: projectName,
      fontSize: 22,
      bold: true,
      color: COLORS.primary,
      margin: [0, 0, 0, 30],
    },

    // Fecha
    {
      table: {
        widths: [100, '*'],
        body: [
          [
            { text: 'Fecha:', bold: true, fontSize: 10, color: COLORS.medGray, border: [false, false, false, false] },
            { text: fechaHoy, fontSize: 10, color: COLORS.darkGray, border: [false, false, false, false] },
          ],
        ],
      },
      layout: 'noBorders',
      margin: [0, 0, 0, 10],
    },

    // Línea divisora
    {
      canvas: [
        { type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: COLORS.lightGray },
      ],
      margin: [0, 20, 0, 20],
    },

    // Info contacto compucad
    {
      text: 'Servicio Extraordinario para Ti',
      fontSize: 12,
      bold: true,
      color: COLORS.primary,
      margin: [0, 0, 0, 5],
    },
    {
      text: 'Compucad — Infraestructura & Soluciones TI',
      fontSize: 9,
      color: COLORS.medGray,
      margin: [0, 0, 0, 2],
    },
    {
      text: 'CDMX | Monterrey | Guadalajara | Querétaro',
      fontSize: 9,
      color: COLORS.medGray,
    },

    { text: '', pageBreak: 'after' },
  ];

  // ──────────────────────────────────────────
  // PÁGINA DE RESUMEN
  // ──────────────────────────────────────────
  const summaryPage = [
    orangeBar(),

    // Header con logo
    ...(logoBase64 ? [{
      columns: [
        { image: logoBase64, width: 90 },
        {
          text: `Reporte de Avances`,
          fontSize: 14,
          bold: true,
          color: COLORS.primary,
          alignment: 'right',
          margin: [0, 10, 0, 0],
        },
      ],
      margin: [0, 0, 0, 15],
    }] : []),

    {
      text: `Reporte de Status del Proyecto ${projectName}`,
      fontSize: 14,
      bold: true,
      color: COLORS.darkGray,
      margin: [0, 0, 0, 15],
    },

    // Resumen numérico
    {
      columns: [
        {
          width: '33%',
          stack: [
            { text: String(counts.completed), fontSize: 28, bold: true, color: COLORS.green, alignment: 'center' },
            { text: 'Completadas', fontSize: 9, color: COLORS.medGray, alignment: 'center' },
          ],
        },
        {
          width: '33%',
          stack: [
            { text: String(counts.inProgress), fontSize: 28, bold: true, color: COLORS.yellow, alignment: 'center' },
            { text: 'En proceso', fontSize: 9, color: COLORS.medGray, alignment: 'center' },
          ],
        },
        {
          width: '33%',
          stack: [
            { text: String(counts.notStarted), fontSize: 28, bold: true, color: COLORS.lightGray, alignment: 'center' },
            { text: 'Sin iniciar', fontSize: 9, color: COLORS.medGray, alignment: 'center' },
          ],
        },
      ],
      margin: [0, 0, 0, 20],
    },

    // Tabla resumen de actividades principales
    sectionTitle('Resumen de Actividades'),

    {
      table: {
        headerRows: 1,
        widths: ['auto', '*', 60, 130],
        body: [
          // Header
          [
            { text: '#', bold: true, fontSize: 8, color: COLORS.white, fillColor: COLORS.darkGray, margin: [4, 4] },
            { text: 'Actividad', bold: true, fontSize: 8, color: COLORS.white, fillColor: COLORS.darkGray, margin: [4, 4] },
            { text: 'Estado', bold: true, fontSize: 8, color: COLORS.white, fillColor: COLORS.darkGray, margin: [4, 4] },
            { text: 'Progreso', bold: true, fontSize: 8, color: COLORS.white, fillColor: COLORS.darkGray, margin: [4, 4] },
          ],
          // Filas — solo tareas de nivel 1 (principales)
          ...groups.map((g, gi) => {
            const mainTasks = g.tareas.filter(t => t.nivel <= 1);
            const groupPct = mainTasks.length
              ? Math.round(mainTasks.reduce((s, t) => s + t.porcentaje_100, 0) / mainTasks.length)
              : 0;
            const estado = groupPct === 100 ? 'Completado' : groupPct > 0 ? 'En proceso' : 'Sin iniciar';
            return [
              { text: String(gi + 1), fontSize: 8, margin: [4, 4], color: COLORS.darkGray },
              { text: g.grupo, fontSize: 8, margin: [4, 4], color: COLORS.darkGray },
              statusBadge(estado),
              { stack: [progressBar(groupPct, 120, 12), { text: `${groupPct}%`, fontSize: 7, color: COLORS.medGray, margin: [0, 2, 0, 0] }], margin: [4, 4] },
            ];
          }),
        ],
      },
      layout: {
        hLineWidth: () => 0.5,
        vLineWidth: () => 0,
        hLineColor: () => COLORS.lightGray,
      },
      margin: [0, 0, 0, 20],
    },

    // Gráfica
    sectionTitle('Distribución de Avance'),
    {
      image: chartBase64,
      width: 400,
      alignment: 'center',
      margin: [0, 10, 0, 10],
    },

    { text: '', pageBreak: 'after' },
  ];

  // ──────────────────────────────────────────
  // PÁGINAS DE DETALLE POR GRUPO
  // ──────────────────────────────────────────
  const detailPages = [];

  groups.forEach((g, gi) => {
    // Header de cada página de detalle
    detailPages.push(orangeBar());

    if (logoBase64) {
      detailPages.push({
        columns: [
          { image: logoBase64, width: 80 },
          {
            text: `Reporte de Avances`,
            fontSize: 12,
            bold: true,
            color: COLORS.primary,
            alignment: 'right',
            margin: [0, 8, 0, 0],
          },
        ],
        margin: [0, 0, 0, 10],
      });
    }

    detailPages.push(sectionTitle(`${gi + 1}. ${g.grupo}`));

    // Tabla detallada de tareas
    const tableBody = [
      // Header
      [
        { text: '#', bold: true, fontSize: 8, color: COLORS.white, fillColor: COLORS.darkGray, margin: [4, 4] },
        { text: 'Tarea', bold: true, fontSize: 8, color: COLORS.white, fillColor: COLORS.darkGray, margin: [4, 4] },
        { text: 'Estado', bold: true, fontSize: 8, color: COLORS.white, fillColor: COLORS.darkGray, margin: [4, 4] },
        { text: 'Progreso', bold: true, fontSize: 8, color: COLORS.white, fillColor: COLORS.darkGray, margin: [4, 4] },
      ],
    ];

    g.tareas.forEach((t, ti) => {
      const rowBg = ti % 2 === 0 ? null : '#FAFAFA';
      tableBody.push([
        { text: String(ti + 1), fontSize: 8, margin: [4, 3], color: COLORS.darkGray, fillColor: rowBg },
        { text: t.TareaDisplay, fontSize: 8, margin: [4, 3], color: COLORS.darkGray, bold: t.nivel <= 1, fillColor: rowBg },
        { ...statusBadge(t.Estado), fillColor: rowBg, margin: [4, 3] },
        {
          stack: [
            progressBar(t.porcentaje_100, 100, 10),
            { text: `${t.porcentaje_100}%`, fontSize: 7, color: COLORS.medGray, margin: [0, 1, 0, 0] },
          ],
          margin: [4, 3],
          fillColor: rowBg,
        },
      ]);
    });

    detailPages.push({
      table: {
        headerRows: 1,
        widths: ['auto', '*', 70, 110],
        body: tableBody,
      },
      layout: {
        hLineWidth: () => 0.5,
        vLineWidth: () => 0,
        hLineColor: () => COLORS.lightGray,
      },
      margin: [0, 0, 0, 10],
    });

    // Resumen del grupo
    const completedTasks = g.tareas.filter(t => t.Estado === 'Completado');
    const inProgressTasks = g.tareas.filter(t => t.Estado === 'En proceso');
    const notStartedTasks = g.tareas.filter(t => t.Estado === 'Sin iniciar');

    if (completedTasks.length > 0) {
      detailPages.push(subSectionTitle('Actividades Completadas'));
      detailPages.push({
        ul: completedTasks.map(t => ({ text: `${t.Tarea} — Completado`, fontSize: 8, color: COLORS.medGray })),
        margin: [10, 0, 0, 8],
      });
    }

    if (inProgressTasks.length > 0) {
      detailPages.push(subSectionTitle('Actividades en Curso'));
      detailPages.push({
        ul: inProgressTasks.map(t => ({ text: `${t.Tarea} — ${t.porcentaje_100}%`, fontSize: 8, color: COLORS.medGray })),
        margin: [10, 0, 0, 8],
      });
    }

    if (notStartedTasks.length > 0) {
      detailPages.push(subSectionTitle('Próximos Pasos'));
      detailPages.push({
        ul: notStartedTasks.map(t => ({ text: `${t.Tarea} — Sin iniciar`, fontSize: 8, color: COLORS.medGray })),
        margin: [10, 0, 0, 8],
      });
    }

    // Page break entre grupos (excepto el último)
    if (gi < groups.length - 1) {
      detailPages.push({ text: '', pageBreak: 'after' });
    }
  });

  // ──────────────────────────────────────────
  // Document definition
  // ──────────────────────────────────────────
  const docDefinition = {
    pageSize: 'LETTER',
    pageMargins: [40, 40, 40, 50],
    defaultStyle: {
      font: 'Helvetica',
      fontSize: 10,
      color: COLORS.darkGray,
    },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: 'Compucad — Infraestructura & Soluciones TI', fontSize: 7, color: COLORS.medGray, margin: [40, 0, 0, 0] },
        { text: `${currentPage} / ${pageCount}`, fontSize: 7, color: COLORS.medGray, alignment: 'right', margin: [0, 0, 40, 0] },
      ],
      margin: [0, 10, 0, 0],
    }),
    content: [
      ...coverPage,
      ...summaryPage,
      ...detailPages,
    ],
  };

  // ── Generar PDF ──
  const outDir = path.join(__dirname, '../output');
  fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, `${outputName}.pdf`);

  return new Promise((resolve, reject) => {
    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    const stream = fs.createWriteStream(outPath);
    pdfDoc.pipe(stream);
    pdfDoc.end();

    stream.on('finish', () => resolve({ outPath }));
    stream.on('error', (err) => reject(err));
  });
}
