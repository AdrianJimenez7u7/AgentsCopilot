import PizZip from 'pizzip';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
 
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
 
// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
function getEstado(pct) {
  const v = Number(pct ?? 0);
  if (v === 100) return 'Completado';
  if (v > 0 && v < 100) return 'En proceso';
  return 'Sin iniciar';
}
 
function estadoColor(estado) {
  if (estado === 'Completado') return '4CAF50';  // green
  if (estado === 'En proceso') return 'FFC107';  // yellow/amber
  return 'E0E0E0';  // gray
}
 
function estadoTextColor(estado) {
  if (estado === 'Sin iniciar') return '333333';
  return 'FFFFFF';
}
 
function barFillColor(pct) {
  if (pct >= 100) return '4CAF50';
  if (pct > 0) return 'FFC107';
  return 'E0E0E0';
}
 
function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDateEs(dateValue) {
  if (!dateValue) return '';
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

function getDateValue(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}
 
// ──────────────────────────────────────────────
// OOXML builders
// ──────────────────────────────────────────────
 
/** Título de grupo con fondo naranja */
function xmlGroupTitle(text) {
  return `<w:p>
    <w:pPr><w:shd w:val="clear" w:color="auto" w:fill="E87722"/><w:spacing w:before="240" w:after="120"/>
    <w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:b/><w:bCs/><w:color w:val="FFFFFF"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:pPr>
    <w:r><w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:b/><w:bCs/><w:color w:val="FFFFFF"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}
 
/** Header de la tabla de tareas */
function xmlTaskTableHeader() {
  const cellStyle = (w) => `<w:tcPr><w:tcW w:w="${w}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/><w:tcMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar></w:tcPr>`;
  const hdrRun = (text) => `<w:r><w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:b/><w:bCs/><w:sz w:val="16"/><w:szCs w:val="16"/><w:color w:val="666666"/></w:rPr><w:t>${escapeXml(text)}</w:t></w:r>`;
 
  return `<w:tr><w:trPr><w:trHeight w:val="280"/></w:trPr>
    <w:tc>${cellStyle('420')}<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${hdrRun('#')}</w:p></w:tc>
    <w:tc>${cellStyle('4200')}<w:p>${hdrRun('Tarea')}</w:p></w:tc>
    <w:tc>${cellStyle('1200')}<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${hdrRun('Estado')}</w:p></w:tc>
    <w:tc>${cellStyle('2700')}<w:p>${hdrRun('Progreso')}</w:p></w:tc>
  </w:tr>`;
}
 
/** Badge de estado con fondo coloreado */
function xmlStatusBadge(estado) {
  const bg = estadoColor(estado);
  const fg = estadoTextColor(estado);
  return `<w:r><w:rPr>
    <w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/>
    <w:b/><w:bCs/><w:sz w:val="14"/><w:szCs w:val="14"/>
    <w:color w:val="${fg}"/>
    <w:shd w:val="clear" w:color="auto" w:fill="${bg}"/>
  </w:rPr><w:t xml:space="preserve"> ${escapeXml(estado)} </w:t></w:r>`;
}
 
/** Barra de progreso visual usando tabla anidada */
function xmlProgressBar(pct) {
  const v = Math.max(0, Math.min(100, Math.round(Number(pct ?? 0))));
  const fillColor = barFillColor(v);
  // Ancho total de la barra: 2000 twips ≈ 3.5cm
  const totalW = 2000;
  const filledW = Math.max(v > 0 ? 100 : 0, Math.round((v / 100) * totalW));
  const emptyW = totalW - filledW;
 
  let barCells = '';
  if (filledW > 0) {
    barCells += `<w:tc><w:tcPr><w:tcW w:w="${filledW}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${fillColor}"/><w:tcMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:pPr><w:spacing w:after="0" w:line="120" w:lineRule="exact"/></w:pPr></w:p></w:tc>`;
  }
  if (emptyW > 0) {
    barCells += `<w:tc><w:tcPr><w:tcW w:w="${emptyW}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="E8E8E8"/><w:tcMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:pPr><w:spacing w:after="0" w:line="120" w:lineRule="exact"/></w:pPr></w:p></w:tc>`;
  }
 
  const barTable = `<w:tbl><w:tblPr><w:tblW w:w="${totalW}" w:type="dxa"/><w:tblBorders>
    <w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/>
    <w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>
    <w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/>
    <w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>
    <w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>
    <w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>
  </w:tblBorders><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="0"/></w:tblPr>
  <w:tblGrid>${filledW > 0 ? `<w:gridCol w:w="${filledW}"/>` : ''}${emptyW > 0 ? `<w:gridCol w:w="${emptyW}"/>` : ''}</w:tblGrid>
  <w:tr><w:trPr><w:trHeight w:val="120" w:hRule="exact"/></w:trPr>${barCells}</w:tr></w:tbl>`;
 
  // Párrafo con % debajo
  const pctText = `<w:p><w:pPr><w:spacing w:before="20" w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:sz w:val="14"/><w:szCs w:val="14"/><w:color w:val="999999"/></w:rPr><w:t>${v}%</w:t></w:r></w:p>`;
 
  return barTable + pctText;
}
 
/** Fila de tarea con: #, nombre, badge de estado, barra de progreso */
function xmlTaskRow(index, tarea, estado, pct, isEven) {
  const rowBg = isEven ? 'FAFAFA' : 'FFFFFF';
  const cellMargin = `<w:tcMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar>`;
 
  return `<w:tr><w:trPr><w:trHeight w:val="500"/></w:trPr>
    <w:tc><w:tcPr><w:tcW w:w="420" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${rowBg}"/>${cellMargin}</w:tcPr>
      <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:sz w:val="16"/><w:szCs w:val="16"/><w:color w:val="999999"/></w:rPr><w:t>${index}</w:t></w:r></w:p></w:tc>
    <w:tc><w:tcPr><w:tcW w:w="4200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${rowBg}"/>${cellMargin}</w:tcPr>
      <w:p><w:r><w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="333333"/></w:rPr><w:t xml:space="preserve">${escapeXml(tarea)}</w:t></w:r></w:p></w:tc>
    <w:tc><w:tcPr><w:tcW w:w="1200" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${rowBg}"/>${cellMargin}<w:vAlign w:val="center"/></w:tcPr>
      <w:p><w:pPr><w:jc w:val="center"/></w:pPr>${xmlStatusBadge(estado)}</w:p></w:tc>
    <w:tc><w:tcPr><w:tcW w:w="2700" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${rowBg}"/>${cellMargin}</w:tcPr>
      ${xmlProgressBar(pct)}</w:tc>
  </w:tr>`;
}
 
/** Tabla completa de tareas de un grupo */
function xmlTaskTable(tareas) {
  const tblBorders = `<w:tblBorders>
    <w:top w:val="single" w:sz="4" w:space="0" w:color="E0E0E0"/>
    <w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>
    <w:bottom w:val="single" w:sz="4" w:space="0" w:color="E0E0E0"/>
    <w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>
    <w:insideH w:val="single" w:sz="4" w:space="0" w:color="E0E0E0"/>
    <w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>
  </w:tblBorders>`;
 
  const rows = tareas.map((t, i) => xmlTaskRow(i + 1, t.tarea, t.estado, t.porcentaje, i % 2 === 0));
 
  return `<w:tbl><w:tblPr><w:tblW w:w="8520" w:type="dxa"/>${tblBorders}<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>
    <w:tblGrid><w:gridCol w:w="420"/><w:gridCol w:w="4200"/><w:gridCol w:w="1200"/><w:gridCol w:w="2700"/></w:tblGrid>
    ${xmlTaskTableHeader()}${rows.join('')}</w:tbl>`;
}
 
/** Subtítulo (Actividades Completadas, etc.) */
function xmlSubTitle(text) {
  return `<w:p><w:pPr><w:spacing w:before="160" w:after="60"/>
    <w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:b/><w:bCs/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:pPr>
    <w:r><w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:b/><w:bCs/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

/** Titulo de caso CRM */
function xmlCaseTitle(text) {
  return `<w:p><w:pPr><w:spacing w:before="120" w:after="40"/>
    <w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:b/><w:bCs/><w:sz w:val="19"/><w:szCs w:val="19"/><w:color w:val="333333"/></w:rPr></w:pPr>
    <w:r><w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:b/><w:bCs/><w:sz w:val="19"/><w:szCs w:val="19"/><w:color w:val="333333"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function xmlCaseSeparator() {
  return `<w:p><w:pPr><w:spacing w:after="80"/>
    <w:pBdr><w:bottom w:val="single" w:sz="6" w:space="6" w:color="E0E0E0"/></w:pBdr>
  </w:pPr></w:p>`;
}

/** Bullet item con indentacion extra (comentarios) */
function xmlCommentItem(text) {
  return `<w:p><w:pPr><w:spacing w:after="30"/><w:ind w:left="720"/>
    <w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="666666"/></w:rPr></w:pPr>
    <w:r><w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="666666"/></w:rPr><w:t xml:space="preserve">-  ${escapeXml(text)}</w:t></w:r></w:p>`;
}

function xmlPercentLine(text) {
  return `<w:p><w:pPr><w:spacing w:before="60" w:after="80"/>
    <w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="333333"/></w:rPr></w:pPr>
    <w:r><w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="333333"/></w:rPr><w:t>${escapeXml(text)}</w:t></w:r></w:p>`;
}

function xmlRiskTableHeader() {
  const cellStyle = (w) => `<w:tcPr><w:tcW w:w="${w}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F5F5F5"/><w:tcMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar></w:tcPr>`;
  const hdrRun = (text) => `<w:r><w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:b/><w:bCs/><w:sz w:val="16"/><w:szCs w:val="16"/><w:color w:val="666666"/></w:rPr><w:t>${escapeXml(text)}</w:t></w:r>`;
  return `<w:tr><w:trPr><w:trHeight w:val="280"/></w:trPr>
    <w:tc>${cellStyle('2200')}<w:p>${hdrRun('Riesgo')}</w:p></w:tc>
    <w:tc>${cellStyle('1400')}<w:p>${hdrRun('Impacto')}</w:p></w:tc>
    <w:tc>${cellStyle('1400')}<w:p>${hdrRun('Prob.')}</w:p></w:tc>
    <w:tc>${cellStyle('1400')}<w:p>${hdrRun('Severidad')}</w:p></w:tc>
    <w:tc>${cellStyle('2520')}<w:p>${hdrRun('Mitigacion')}</w:p></w:tc>
  </w:tr>`;
}

function xmlRiskRow(item, isEven) {
  const rowBg = isEven ? 'FAFAFA' : 'FFFFFF';
  const cellMargin = `<w:tcMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tcMar>`;
  const cellText = (text, w) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${rowBg}"/>${cellMargin}</w:tcPr>
    <w:p><w:r><w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="333333"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:tc>`;
  return `<w:tr><w:trPr><w:trHeight w:val="520"/></w:trPr>
    ${cellText(item.riesgo || '', '2200')}
    ${cellText(item.impacto || '', '1400')}
    ${cellText(item.probabilidad || '', '1400')}
    ${cellText(item.severidad || '', '1400')}
    ${cellText(item.mitigacion || '', '2520')}
  </w:tr>`;
}

function xmlRiskTable(items) {
  const tblBorders = `<w:tblBorders>
    <w:top w:val="single" w:sz="4" w:space="0" w:color="E0E0E0"/>
    <w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>
    <w:bottom w:val="single" w:sz="4" w:space="0" w:color="E0E0E0"/>
    <w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>
    <w:insideH w:val="single" w:sz="4" w:space="0" w:color="E0E0E0"/>
    <w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>
  </w:tblBorders>`;
  const rows = items.map((item, i) => xmlRiskRow(item, i % 2 === 0));
  return `<w:tbl><w:tblPr><w:tblW w:w="8920" w:type="dxa"/>${tblBorders}<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>
    <w:tblGrid><w:gridCol w:w="2200"/><w:gridCol w:w="1400"/><w:gridCol w:w="1400"/><w:gridCol w:w="1400"/><w:gridCol w:w="2520"/></w:tblGrid>
    ${xmlRiskTableHeader()}${rows.join('')}</w:tbl>`;
}
 
/** Bullet item */
function xmlBulletItem(text) {
  return `<w:p><w:pPr><w:spacing w:after="40"/><w:ind w:left="360"/>
    <w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="666666"/></w:rPr></w:pPr>
    <w:r><w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="666666"/></w:rPr><w:t xml:space="preserve">•  ${escapeXml(text)}</w:t></w:r></w:p>`;
}
 
function xmlSpacer() {
  return `<w:p><w:pPr><w:spacing w:after="60"/></w:pPr></w:p>`;
}

/** Barra de estado del proyecto con tres segmentos: Completado, En Proceso, Sin Iniciar */
function xmlProjectProgressBar(counts) {
  const total = counts.completed + counts.inProgress + counts.notStarted;
  if (total === 0) {
    return `<w:p><w:r><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="999999"/></w:rPr><w:t>Sin datos</w:t></w:r></w:p>`;
  }

  const totalW = 4500; // Ancho total de la barra en twips (más grande)
  const completedW = Math.round((counts.completed / total) * totalW);
  const inProgressW = Math.round((counts.inProgress / total) * totalW);
  const notStartedW = totalW - completedW - inProgressW;

  let barCells = '';
  if (completedW > 0) {
    barCells += `<w:tc><w:tcPr><w:tcW w:w="${completedW}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="4CAF50"/><w:tcMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:pPr><w:spacing w:after="0" w:line="180" w:lineRule="exact"/></w:pPr></w:p></w:tc>`;
  }
  if (inProgressW > 0) {
    barCells += `<w:tc><w:tcPr><w:tcW w:w="${inProgressW}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="FFC107"/><w:tcMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:pPr><w:spacing w:after="0" w:line="180" w:lineRule="exact"/></w:pPr></w:p></w:tc>`;
  }
  if (notStartedW > 0) {
    barCells += `<w:tc><w:tcPr><w:tcW w:w="${notStartedW}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="E0E0E0"/><w:tcMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:pPr><w:spacing w:after="0" w:line="180" w:lineRule="exact"/></w:pPr></w:p></w:tc>`;
  }

  const barTable = `<w:tbl><w:tblPr><w:tblW w:w="${totalW}" w:type="dxa"/><w:tblBorders>
    <w:top w:val="single" w:sz="6" w:space="0" w:color="D3D3D3"/>
    <w:left w:val="single" w:sz="6" w:space="0" w:color="D3D3D3"/>
    <w:bottom w:val="single" w:sz="6" w:space="0" w:color="D3D3D3"/>
    <w:right w:val="single" w:sz="6" w:space="0" w:color="D3D3D3"/>
    <w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/>
    <w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>
  </w:tblBorders><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar><w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="0"/></w:tblPr>
  <w:tblGrid>${completedW > 0 ? `<w:gridCol w:w="${completedW}"/>` : ''}${inProgressW > 0 ? `<w:gridCol w:w="${inProgressW}"/>` : ''}${notStartedW > 0 ? `<w:gridCol w:w="${notStartedW}"/>` : ''}</w:tblGrid>
  <w:tr><w:trPr><w:trHeight w:val="180" w:hRule="exact"/></w:trPr>${barCells}</w:tr></w:tbl>`;

  // Leyenda en línea horizontal con mejor diseño
  const completedPct = Math.round((counts.completed / total) * 100);
  const inProgressPct = Math.round((counts.inProgress / total) * 100);
  const notStartedPct = Math.round((counts.notStarted / total) * 100);

  const legend = `<w:p><w:pPr><w:spacing w:before="120" w:after="60"/></w:pPr></w:p>
  <w:p><w:r><w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:b/><w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="4CAF50"/></w:rPr><w:t xml:space="preserve">● Completado: ${counts.completed} (${completedPct}%)</w:t></w:r></w:p>
  <w:p><w:r><w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:b/><w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="FFC107"/></w:rPr><w:t xml:space="preserve">● En proceso: ${counts.inProgress} (${inProgressPct}%)</w:t></w:r></w:p>
  <w:p><w:r><w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:b/><w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="999999"/></w:rPr><w:t xml:space="preserve">● Sin iniciar: ${counts.notStarted} (${notStartedPct}%)</w:t></w:r></w:p>`;

  return barTable + legend;
}
 
// ──────────────────────────────────────────────
// Preparar datos
// ──────────────────────────────────────────────
function prepareData(data, nameReport) {
  const sortedData = Array.isArray(data)
    ? [...data].sort((a, b) => Number(a.posicion ?? a.pos ?? 0) - Number(b.posicion ?? b.pos ?? 0))
    : [];
 
  const groupsMap = sortedData.reduce((acc, t) => {
    const g = String(t.Grupo ?? 'Sin grupo');
    if (!acc[g]) acc[g] = [];
    acc[g].push(t);
    return acc;
  }, {});
 
  const groups = Object.entries(groupsMap).map(([grupo, tasks], gi) => ({
    grupo, index: gi + 1,
    tareas: tasks.map(t => {
      const v = Number(t.porcentaje_100 ?? t.porcentaje ?? 0);
      return { tarea: t.Tarea ?? '', estado: getEstado(v), porcentaje: v };
    }),
  }));
 
  const total = sortedData.length;
  const globalPct = total > 0
    ? Math.round(groups.reduce((s, g) => s + g.tareas.reduce((s2, t) => s2 + t.porcentaje, 0), 0) / total)
    : 0;
 
  const now = new Date();
  const fmt = (d) => d.toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
  let minDate = null;
  let maxDate = null;
  let minCreated = null;
  let maxCreated = null;
  sortedData.forEach(t => {
    const start = getDateValue(t.FechaInicio || t.fechaInicio || t.start || t.msdyn_start);
    const finish = getDateValue(t.FechaFin || t.fechaFin || t.finish || t.msdyn_finish);
    const created = getDateValue(t.creadoEn || t.createdon || t.CreadoEn);
    if (start && (!minDate || start < minDate)) minDate = start;
    if (finish && (!maxDate || finish > maxDate)) maxDate = finish;
    if (created && (!minCreated || created < minCreated)) minCreated = created;
    if (created && (!maxCreated || created > maxCreated)) maxCreated = created;
  });
  let fromDate = minDate;
  let toDate = maxDate;
  if (!fromDate || !toDate || (fromDate && toDate && fromDate.getTime() === toDate.getTime())) {
    if (minCreated && maxCreated) {
      fromDate = minCreated;
      toDate = maxCreated;
    }
  }
  const fechaDesde = fromDate ? fmt(fromDate) : fmt(new Date(now.getFullYear(), now.getMonth(), 1));
  const fechaHasta = toDate ? fmt(toDate) : fmt(now);
  const fechaHoy = fmt(now);
 
  const counts = { completed: 0, inProgress: 0, notStarted: 0 };
  groups.forEach(g => g.tareas.forEach(t => {
    if (t.estado === 'Completado') counts.completed++;
    else if (t.estado === 'En proceso') counts.inProgress++;
    else counts.notStarted++;
  }));
 
  return { groups, total, globalPct, fechaDesde, fechaHasta, fechaHoy, counts, titulo: nameReport || 'Reporte de Avances' };
}
 
// ──────────────────────────────────────────────
// Construir contenido de secciones
// ──────────────────────────────────────────────
 
function buildExecutedTasksXml(report) {
  const parts = [];
 
  report.groups.forEach(g => {
    const started = g.tareas.filter(t => t.porcentaje > 0);
    if (started.length === 0) return;
 
    parts.push(xmlGroupTitle(`${g.index}. ${g.grupo}`));
    parts.push(xmlTaskTable(started));
 
    const completed = started.filter(t => t.estado === 'Completado');
    if (completed.length > 0) {
      parts.push(xmlSubTitle('Actividades Completadas'));
      completed.forEach(t => parts.push(xmlBulletItem(`${t.tarea} — Completado`)));
    }
 
    const inProgress = started.filter(t => t.estado === 'En proceso');
    if (inProgress.length > 0) {
      parts.push(xmlSubTitle('Actividades en Curso'));
      inProgress.forEach(t => parts.push(xmlBulletItem(`${t.tarea} — ${t.porcentaje}%`)));
    }
 
    parts.push(xmlSpacer());
  });
 
  if (parts.length === 0) {
    parts.push(xmlBulletItem('No hay tareas ejecutadas en este periodo.'));
  }
  return parts.join('');
}
 
function buildUpcomingTasksXml(report) {
  const parts = [];
 
  report.groups.forEach(g => {
    const notStarted = g.tareas.filter(t => t.porcentaje === 0);
    if (notStarted.length === 0) return;
 
    parts.push(xmlGroupTitle(`${g.index}. ${g.grupo}`));
    parts.push(xmlTaskTable(notStarted));
    parts.push(xmlSpacer());
  });
 
  if (parts.length === 0) {
    parts.push(xmlBulletItem('Todas las tareas han sido iniciadas.'));
  }
  return parts.join('');
}
 
// ──────────────────────────────────────────────
// Generar DOCX
// ──────────────────────────────────────────────
export async function generateDocxReport(data, outputName = `reporte_${Date.now()}`, chartType = 'bar', nameReport) {
  const templatePath = path.join(__dirname, '../data/CCD-PMO-F03.docx');
  const content = fs.readFileSync(templatePath, 'binary');
  const zip = new PizZip(content);
  let docXml = zip.file('word/document.xml').asText();

  // Support payloads that include both tasks array and meta info
  // If `data` is an object with `tasks` or `items`, extract them; otherwise assume it's an array of tasks
  let inputTasks = Array.isArray(data) ? data : (data?.tasks || data?.items || []);
  const extraMeta = data && !Array.isArray(data) ? (data.meta || { caseId: data.caseId, plannerName: data.plannerName, comments: data.comments }) : {};

  const report = prepareData(inputTasks, nameReport);
 
  // ═══ 1. Content Controls ═══
  docXml = docXml.replace(
    /(<w:sdtContent>[\s\S]*?<w:t[^>]*>)(Formato de reporte de avances)(<\/w:t>[\s\S]*?<\/w:sdtContent>)/g,
    `$1${escapeXml(report.titulo)}$3`
  );
  docXml = docXml.replace(
    /(<w:sdtContent>[\s\S]*?<w:t[^>]*>)(Compañía)(<\/w:t>[\s\S]*?<\/w:sdtContent>)/g,
    `$1${escapeXml(report.titulo)}$3`
  );
 
  // ═══ 2. Porcentaje global ═══
  // Eliminar la barra azul del "% COMPLETADO" de la plantilla
  docXml = docXml.replace(
    /(<w:p>[\s\S]*?% COMPLETADO[\s\S]*?<\/w:p>[\s\S]*?<w:p>[\s\S]*?<\/w:p>)/,
    ''
  );

  // ═══ 2b. Fechas Desde/Hasta (tabla 2) ═══
  // Celda vacía después de "Desde" — inyectar fecha
  docXml = docXml.replace(
    /(Desde<\/w:t><\/w:r><\/w:p><\/w:tc>\s*<w:tc>\s*<w:tcPr>[\s\S]*?<\/w:tcPr>\s*<w:p[^>]*>)([\s\S]*?)(<\/w:p>\s*<\/w:tc>\s*<\/w:tr>)/,
    `$1<w:r><w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:sz w:val="22"/><w:szCs w:val="21"/></w:rPr><w:t>${escapeXml(report.fechaDesde)}</w:t></w:r>$3`
  );
  // Celda vacía después de "Hasta"
  docXml = docXml.replace(
    /(Hasta<\/w:t><\/w:r><\/w:p><\/w:tc>\s*<w:tc>\s*<w:tcPr>[\s\S]*?<\/w:tcPr>\s*<w:p[^>]*>)([\s\S]*?)(<\/w:p>\s*<\/w:tc>\s*<\/w:tr>)/,
    `$1<w:r><w:rPr><w:rFonts w:ascii="Century Gothic" w:hAnsi="Century Gothic"/><w:sz w:val="22"/><w:szCs w:val="21"/></w:rPr><w:t>${escapeXml(report.fechaHasta)}</w:t></w:r>$3`
  );

  // ═══ 2c. Porcentaje de proyecto + barra ═══
  const projectBarXml = xmlProjectProgressBar(report.counts);
  const percentLine = xmlPercentLine(`${report.globalPct}%`);
  docXml = docXml.replace(
    /(<w:p[\s\S]*?Porcentaje de Proyecto completado[\s\S]*?<\/w:p>)/,
    `$1${percentLine}${projectBarXml}`
  );

  // ═══ 2d. Notas adicionales ═══
  const notasXml = [
    xmlBulletItem(`Total de tareas: ${report.total}`),
    xmlBulletItem(`Completadas: ${report.counts.completed} | En proceso: ${report.counts.inProgress} | Sin iniciar: ${report.counts.notStarted}`),
    xmlBulletItem(`Porcentaje global de avance: ${report.globalPct}%`),
    xmlBulletItem(`Fecha de generación: ${report.fechaHoy}`),
  ].join('');
  docXml = docXml.replace(
    /(adicionales[\s\S]*?<w:t>:<\/w:t><\/w:r><\/w:p>)/,
    `$1${notasXml}`
  );

  // ═══ Meta CRM / Planner (si viene en payload) ═══
  if (extraMeta && (extraMeta.caseId || extraMeta.plannerName || (Array.isArray(extraMeta.comments) && extraMeta.comments.length > 0) || (Array.isArray(extraMeta.casos) && extraMeta.casos.length > 0))) {
    const metaParts = [];
    if (extraMeta.caseId) metaParts.push(xmlBulletItem(`Caso CRM: ${extraMeta.caseId}`));
    if (extraMeta.plannerName) metaParts.push(xmlBulletItem(`Planner: ${extraMeta.plannerName}`));
    if (Array.isArray(extraMeta.casos) && extraMeta.casos.length > 0) {
      metaParts.push(xmlSubTitle('Casos CRM relacionados'));
      extraMeta.casos.forEach(caso => {
        const labelParts = [];
        if (caso.casoNumero) labelParts.push(`Caso #${caso.casoNumero}`);
        if (caso.casoTitulo) labelParts.push(caso.casoTitulo);
        const statusLabel = caso.casoEstadoLabel || caso.casoEstado;
        const labelBase = labelParts.length > 0 ? labelParts.join(' - ') : (caso.casoId || 'Caso');
        const label = statusLabel ? `${labelBase} (${statusLabel})` : labelBase;
        metaParts.push(xmlCaseTitle(label));

        if (Array.isArray(caso.comentarios) && caso.comentarios.length > 0) {
          caso.comentarios.forEach(com => {
            const txt = com.descripcion || com.notetext || com.text || '';
            const fecha = formatDateEs(com.creadoEn || com.createdon);
            const autor = com.autor || com.author || '';
            const prefixParts = [fecha, autor].filter(Boolean);
            const prefix = prefixParts.length > 0 ? `${prefixParts.join(' - ')}: ` : '';
            if (txt) metaParts.push(xmlCommentItem(`${prefix}${txt}`));
          });
        } else {
          metaParts.push(xmlCommentItem('Sin comentarios.'));
        }
        metaParts.push(xmlCaseSeparator());
      });
    }
    if (extraMeta.riskEvaluation) {
      const riskEval = extraMeta.riskEvaluation || {};
      const riskItems = Array.isArray(riskEval.items) ? riskEval.items : [];
      const normalizedItems = riskItems.length > 0
        ? riskItems
        : (riskEval.resumen ? [{ riesgo: riskEval.resumen, impacto: '', probabilidad: '', severidad: '', mitigacion: '' }] : []);
      metaParts.push(xmlSubTitle('Evaluacion de riesgos'));
      if (riskEval.resumen) metaParts.push(xmlBulletItem(`Resumen: ${riskEval.resumen}`));
      if (normalizedItems.length > 0) {
        metaParts.push(xmlRiskTable(normalizedItems));
      } else {
        metaParts.push(xmlCommentItem('Sin riesgos identificados.'));
      }
    }
    if (Array.isArray(extraMeta.comments) && extraMeta.comments.length > 0) {
      metaParts.push(xmlSubTitle('Comentarios relacionados'));
      extraMeta.comments.forEach(c => {
        // c may be string or object {text, author, createdon, parentCase}
        const txt = typeof c === 'string' ? c : (c.notetext || c.text || c.comment || '');
        const metaText = typeof c === 'object' && c.parentCase ? `${txt} (${c.parentCase})` : txt;
        metaParts.push(xmlBulletItem(metaText));
      });
    }

    // Insert meta right after notas (append to the paragraph we replaced above)
    docXml = docXml.replace(
      /(adicionales[\s\S]*?<w:t>:<\/w:t><\/w:r><\/w:p>)/,
      `$1${metaParts.join('')}`
    );
  }
 
  // ═══ 3. Inyectar tareas en secciones ═══
  const ejecutadasContent = buildExecutedTasksXml(report);
  docXml = docXml.replace(
    /(Tareas ejecutadas al momento<\/w:t><\/w:r><\/w:p>)/,
    `$1${ejecutadasContent}`
  );
 
  const proximasContent = buildUpcomingTasksXml(report);
  docXml = docXml.replace(
    /(Próximas tareas<\/w:t><\/w:r><\/w:p>)/,
    `$1${proximasContent}`
  );
 
  // ═══ 4. Actualizar propiedades ═══
  try {
    const coreXml = zip.file('docProps/core.xml')?.asText();
    if (coreXml) zip.file('docProps/core.xml', coreXml.replace(/<dc:title>[^<]*<\/dc:title>/, `<dc:title>${escapeXml(report.titulo)}</dc:title>`));
    const appXml = zip.file('docProps/app.xml')?.asText();
    if (appXml) zip.file('docProps/app.xml', appXml.replace(/<Company>[^<]*<\/Company>/, `<Company>${escapeXml(report.titulo)}</Company>`));
    for (const fileName of Object.keys(zip.files)) {
      if (fileName.startsWith('customXml/item') && fileName.endsWith('.xml')) {
        let itemXml = zip.file(fileName)?.asText();
        if (itemXml) {
          if (itemXml.includes('dc:title') || itemXml.includes('ns0:title'))
            itemXml = itemXml.replace(/(<(?:dc|ns0):title[^>]*>)[^<]*(<\/(?:dc|ns0):title>)/, `$1${escapeXml(report.titulo)}$2`);
          if (itemXml.includes('Company'))
            itemXml = itemXml.replace(/(<(?:ns0:)?Company[^>]*>)[^<]*(<\/(?:ns0:)?Company>)/, `$1${escapeXml(report.titulo)}$2`);
          zip.file(fileName, itemXml);
        }
      }
    }
  } catch (e) { console.warn('Warning updating doc properties:', e.message); }
 
  // ═══ 5. Guardar ═══
  zip.file('word/document.xml', docXml);
  const outDir = path.join(__dirname, '../output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${outputName}.docx`);
  fs.writeFileSync(outPath, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return { outPath };
}