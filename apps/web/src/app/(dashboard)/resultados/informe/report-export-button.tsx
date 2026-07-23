'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Exportación del INFORME COMPLETO (H6.13). A diferencia del <ExportButton>
// genérico (una tabla), este serializa TODAS las secciones del informe en un solo
// archivo:
//   • Excel (.xlsx): un libro con una hoja por sección (síntesis, distribución,
//     comparativa por curso, habilidades, análisis de preguntas, alumnos en foco,
//     recomendaciones).
//   • PDF (.pdf): un documento que reproduce la vista — ficha técnica, KPIs,
//     fortalezas/brechas y cada sección como tabla, con la MISMA codificación de
//     color que la pantalla (niveles de desempeño, dificultad/discriminación,
//     brecha por curso y prioridad de recomendaciones).
// No hace fetch: opera sobre el AssessmentReportResponse ya cargado.
// ─────────────────────────────────────────────────────────────────────────────

import type { JSX } from 'react';
import { useState } from 'react';
import type { WorkBook, WorkSheet } from 'xlsx';
import type { jsPDF } from 'jspdf';
import type { CellHookData } from 'jspdf-autotable';
import { FileDown } from 'lucide-react';
import type { AssessmentReportResponse, ItemReportFlag, PerformanceLevel } from '@soe/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import {
  PERFORMANCE_LEVEL_LABELS,
  PERFORMANCE_LEVEL_ORDER,
  performanceLevelLabel,
} from '../components/performance-level';

type RGB = [number, number, number];

// Paleta para el PDF, equivalente a los tokens Tailwind de la vista.
const LEVEL_FILL: Record<PerformanceLevel, RGB> = {
  insufficient: [254, 226, 226], // red-100
  elementary: [254, 243, 199], // amber-100
  adequate: [209, 250, 229], // emerald-100
  advanced: [219, 234, 254], // blue-100
};
const LEVEL_TEXT: Record<PerformanceLevel, RGB> = {
  insufficient: [153, 27, 27], // red-800
  elementary: [146, 64, 14], // amber-800
  adequate: [6, 95, 70], // emerald-800
  advanced: [30, 64, 175], // blue-800
};
const RED: RGB = [220, 38, 38];
const AMBER: RGB = [217, 119, 6];
const GREEN: RGB = [5, 150, 105];
const MUTED: RGB = [107, 114, 128];
const HEAD: RGB = [37, 99, 235];

const FLAG_LABELS: Record<ItemReportFlag, string> = {
  critical: 'Crítico',
  low_discrimination: 'Baja discriminación',
  strong_distractor: 'Distractor potente',
  easy: 'Muy fácil',
};
const PRIORITY_LABELS: Record<'high' | 'medium' | 'low', string> = {
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
};
const PRIORITY_FILL: Record<'high' | 'medium' | 'low', RGB> = {
  high: [254, 226, 226],
  medium: [254, 243, 199],
  low: [219, 234, 254],
};
const PRIORITY_TEXT: Record<'high' | 'medium' | 'low', RGB> = {
  high: [153, 27, 27],
  medium: [146, 64, 14],
  low: [30, 64, 175],
};

// ── Formateadores (alineados con report-body.tsx) ────────────────────────────

function fmtPct(value: number | null, digits = 1): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}
function fmtNum(value: number | null, digits = 1): string {
  if (value === null || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}
function fmtSigned(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
}
function fmtDate(value: string | Date | null): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CL', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}
function difficultyColor(value: number | null): RGB {
  if (value === null) return MUTED;
  if (value < 40) return RED;
  if (value < 60) return AMBER;
  return GREEN;
}
function discriminationColor(value: number | null): RGB {
  if (value === null) return MUTED;
  if (value < 0.2) return RED;
  if (value < 0.3) return AMBER;
  return GREEN;
}
function sanitize(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, ' ').trim();
}

export function ReportExportButton({ report }: { report: AssessmentReportResponse }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const base =
    `informe-${sanitize(report.meta.assessmentName ?? report.meta.instrumentName)}`.slice(0, 80);

  async function exportExcel() {
    setBusy(true);
    try {
      await buildWorkbook(report, base);
    } finally {
      setBusy(false);
    }
  }
  async function exportPdf() {
    setBusy(true);
    try {
      await buildPdf(report, base);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="default" size="sm" disabled={busy}>
          <FileDown className="mr-2 size-4" aria-hidden />
          Exportar informe
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={exportExcel}>
          Informe completo en Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={exportPdf}>Informe completo en PDF (.pdf)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Excel: un libro multi-hoja ────────────────────────────────────────────────

async function buildWorkbook(report: AssessmentReportResponse, base: string) {
  const XLSX = await import('xlsx');
  const appendSheet = (wb: WorkBook, name: string, ws: WorkSheet) =>
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  const { meta, summary } = report;
  const wb = XLSX.utils.book_new();

  // Hoja 1 — Resumen (ficha técnica + síntesis + fortalezas/brechas).
  const resumen: (string | number)[][] = [
    ['Informe de evaluación'],
    [meta.assessmentName ?? meta.instrumentName],
    [],
    ['Ficha técnica'],
    ['Instrumento', meta.instrumentName],
    ['Asignatura', meta.subjectName ?? '—'],
    ['Nivel', meta.gradeName ?? '—'],
    ['Aplicada', fmtDate(meta.administeredAt)],
    ['Cursos', meta.classGroups.map((c) => c.name).join(', ') || '—'],
    ['Preguntas', meta.itemsCount],
    [],
    ['Síntesis ejecutiva'],
    ['% Logro promedio', fmtPct(summary.averageAchievement)],
    ['Nivel global', performanceLevelLabel(summary.performanceLevel)],
    ['Aprobación', fmtPct(summary.passingRate)],
    ['Nota de corte', fmtNum(summary.passingGrade)],
    ['Nota promedio', fmtNum(summary.averageGrade)],
    ['Alumnos evaluados', summary.studentsEvaluated],
    ['Alumnos matriculados', summary.studentsEnrolled],
    ['Asistencia', fmtPct(summary.coverageRate, 0)],
    [],
    ['Fortalezas', ...report.highlights.strengths],
    ['Brechas prioritarias', ...report.highlights.gaps],
  ];
  appendSheet(wb, 'Resumen', XLSX.utils.aoa_to_sheet(resumen));

  // Hoja 2 — Distribución por nivel.
  appendSheet(
    wb,
    'Distribución',
    XLSX.utils.aoa_to_sheet([
      ['Nivel', 'Alumnos', '% del total'],
      ...PERFORMANCE_LEVEL_ORDER.map((level) => {
        const b = report.distribution.find((x) => x.level === level);
        return [PERFORMANCE_LEVEL_LABELS[level], b?.count ?? 0, fmtPct(b?.percentage ?? 0)];
      }),
    ]),
  );

  // Hoja 3 — Comparativa por curso.
  appendSheet(
    wb,
    'Comparativa por curso',
    XLSX.utils.aoa_to_sheet([
      ['Curso', 'Evaluados', '% Logro', 'Brecha vs prom.', '% Aprobación', 'En riesgo'],
      ...report.courseComparison.map((c) => [
        c.classGroupName,
        c.studentsEvaluated,
        fmtPct(c.averageAchievement),
        fmtSigned(c.gapVsAverage),
        fmtPct(c.passingRate),
        c.criticalStudents,
      ]),
    ]),
  );

  // Hoja 4 — Habilidades.
  appendSheet(
    wb,
    'Habilidades',
    XLSX.utils.aoa_to_sheet([
      ['Habilidad', 'Código', 'Evaluados', '% Logro', 'Nivel'],
      ...report.skills.map((s) => [
        s.nodeName,
        s.nodeCode ?? '—',
        s.studentsAssessed,
        fmtPct(s.averageAchievement),
        performanceLevelLabel(s.performanceLevel),
      ]),
    ]),
  );

  // Hoja 5 — Análisis de preguntas (psicometría).
  appendSheet(
    wb,
    'Análisis de preguntas',
    XLSX.utils.aoa_to_sheet([
      [
        'N°',
        'Habilidad',
        'Contenido',
        'Clave',
        'Dificultad (p%)',
        'Discriminación (D)',
        'Distractor top',
        '% Distractor',
        'Respondidas',
        'En blanco',
        'Alertas',
      ],
      ...report.items.map((i) => [
        i.position,
        i.skillName ?? '—',
        i.contentName ?? '—',
        i.correctKey ?? '—',
        fmtNum(i.difficulty),
        fmtNum(i.discrimination, 2),
        i.topDistractorKey ?? '—',
        fmtPct(i.topDistractorRate),
        i.answeredCount,
        i.blankCount,
        i.flags.map((f) => FLAG_LABELS[f]).join(', '),
      ]),
    ]),
  );

  // Hoja 6 — Alumnos en foco.
  appendSheet(
    wb,
    'Alumnos en foco',
    XLSX.utils.aoa_to_sheet([
      ['Alumno', 'RUT', 'Curso', '% Logro', 'Nivel', 'Habilidad más débil'],
      ...report.studentsAtRisk.map((s) => [
        s.studentFullName,
        s.studentRut,
        s.classGroupName ?? '—',
        fmtPct(s.achievement),
        performanceLevelLabel(s.performanceLevel),
        s.weakestSkill ?? '—',
      ]),
    ]),
  );

  // Hoja 7 — Recomendaciones.
  appendSheet(
    wb,
    'Recomendaciones',
    XLSX.utils.aoa_to_sheet([
      ['Prioridad', 'Recomendación'],
      ...report.recommendations.map((r) => [PRIORITY_LABELS[r.priority], r.message]),
    ]),
  );

  XLSX.writeFile(wb, `${base}.xlsx`);
}


// ── PDF: documento completo con estilo ────────────────────────────────────────

async function buildPdf(report: AssessmentReportResponse, base: string) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const { meta, summary } = report;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const marginX = 14;

  // Título + subtítulo.
  doc.setFontSize(16);
  doc.setTextColor(17, 24, 39);
  doc.text('Informe de evaluación', marginX, 18);
  doc.setFontSize(11);
  doc.text(meta.assessmentName ?? meta.instrumentName, marginX, 25);
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const subtitle = [
    meta.instrumentName,
    meta.subjectName,
    meta.gradeName,
    fmtDate(meta.administeredAt),
  ]
    .filter(Boolean)
    .join('  ·  ');
  doc.text(subtitle, marginX, 31);
  doc.setTextColor(0, 0, 0);

  // Ficha técnica + síntesis como tablas clave-valor lado a lado de info.
  autoTable(doc, {
    startY: 36,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 1 },
    body: [
      [
        'Cursos',
        meta.classGroups.map((c) => c.name).join(', ') || '—',
        'Preguntas',
        String(meta.itemsCount),
      ],
      [
        'Alumnos evaluados',
        `${summary.studentsEvaluated} / ${summary.studentsEnrolled}`,
        'Asistencia',
        fmtPct(summary.coverageRate, 0),
      ],
    ],
    columnStyles: {
      0: { fontStyle: 'bold', textColor: MUTED },
      2: { fontStyle: 'bold', textColor: MUTED },
    },
  });

  // Síntesis ejecutiva — KPIs.
  let y = sectionTitle(doc, 'Síntesis ejecutiva', lastY(doc) + 6, marginX);
  autoTable(doc, {
    startY: y,
    head: [['% Logro promedio', 'Nivel global', 'Aprobación', 'Nota promedio']],
    body: [
      [
        fmtPct(summary.averageAchievement),
        performanceLevelLabel(summary.performanceLevel),
        fmtPct(summary.passingRate),
        fmtNum(summary.averageGrade),
      ],
    ],
    styles: { fontSize: 10, halign: 'center', cellPadding: 3 },
    headStyles: { fillColor: HEAD, halign: 'center' },
    didParseCell: (data: CellHookData) => {
      // Colorea la celda "Nivel global" según el nivel de desempeño.
      if (data.section === 'body' && data.column.index === 1 && summary.performanceLevel) {
        data.cell.styles.fillColor = LEVEL_FILL[summary.performanceLevel];
        data.cell.styles.textColor = LEVEL_TEXT[summary.performanceLevel];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  // Fortalezas / brechas.
  y = lastY(doc) + 5;
  if (report.highlights.strengths.length || report.highlights.gaps.length) {
    doc.setFontSize(9);
    doc.setTextColor(...GREEN);
    doc.text(`Fortalezas: ${report.highlights.strengths.join(' · ') || '—'}`, marginX, y, {
      maxWidth: pageW - marginX * 2,
    });
    y += 5;
    doc.setTextColor(...RED);
    doc.text(`Brechas: ${report.highlights.gaps.join(' · ') || '—'}`, marginX, y, {
      maxWidth: pageW - marginX * 2,
    });
    doc.setTextColor(0, 0, 0);
    y += 2;
  }

  // Distribución por nivel.
  y = sectionTitle(doc, 'Distribución por nivel de desempeño', y + 6, marginX);
  const distLevels = PERFORMANCE_LEVEL_ORDER;
  autoTable(doc, {
    startY: y,
    head: [['Nivel', 'Alumnos', '% del total']],
    body: distLevels.map((level) => {
      const b = report.distribution.find((x) => x.level === level);
      return [PERFORMANCE_LEVEL_LABELS[level], String(b?.count ?? 0), fmtPct(b?.percentage ?? 0)];
    }),
    styles: { fontSize: 9 },
    headStyles: { fillColor: HEAD },
    didParseCell: (data: CellHookData) => {
      if (data.section === 'body' && data.column.index === 0) {
        const level = distLevels[data.row.index];
        if (!level) return;
        data.cell.styles.fillColor = LEVEL_FILL[level];
        data.cell.styles.textColor = LEVEL_TEXT[level];
        data.cell.styles.fontStyle = 'bold';
      }
    },
  });

  // Comparativa por curso.
  if (report.courseComparison.length) {
    y = sectionTitle(doc, 'Comparativa por curso', lastY(doc) + 8, marginX);
    const courses = report.courseComparison;
    autoTable(doc, {
      startY: y,
      head: [['Curso', 'Evaluados', '% Logro', 'Brecha', '% Aprob.', 'En riesgo']],
      body: courses.map((c) => [
        c.classGroupName,
        String(c.studentsEvaluated),
        fmtPct(c.averageAchievement),
        fmtSigned(c.gapVsAverage),
        fmtPct(c.passingRate),
        String(c.criticalStudents),
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: HEAD },
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
      },
      didParseCell: (data: CellHookData) => {
        if (data.section === 'body' && data.column.index === 3) {
          const gap = courses[data.row.index]?.gapVsAverage;
          if (gap !== null && gap !== undefined) {
            data.cell.styles.textColor = gap < 0 ? RED : gap > 0 ? GREEN : MUTED;
            data.cell.styles.fontStyle = 'bold';
          }
        }
      },
    });
  }

  // Logro por habilidad.
  if (report.skills.length) {
    y = sectionTitle(doc, 'Logro por habilidad', lastY(doc) + 8, marginX);
    const skills = report.skills;
    autoTable(doc, {
      startY: y,
      head: [['Habilidad', 'Código', 'Evaluados', '% Logro', 'Nivel']],
      body: skills.map((s) => [
        s.nodeName,
        s.nodeCode ?? '—',
        String(s.studentsAssessed),
        fmtPct(s.averageAchievement),
        performanceLevelLabel(s.performanceLevel),
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: HEAD },
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' } },
      didParseCell: (data: CellHookData) => {
        if (data.section === 'body' && data.column.index === 4) {
          const level = skills[data.row.index]?.performanceLevel;
          if (level) {
            data.cell.styles.fillColor = LEVEL_FILL[level];
            data.cell.styles.textColor = LEVEL_TEXT[level];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      },
    });
  }

  // Análisis de preguntas (psicometría).
  if (report.items.length) {
    y = sectionTitle(doc, 'Análisis de preguntas', lastY(doc) + 8, marginX);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(
      'Dificultad (p): % de logro — bajo = difícil. Discriminación (D): D < 0,2 sugiere revisar la pregunta.',
      marginX,
      y,
      { maxWidth: pageW - marginX * 2 },
    );
    doc.setTextColor(0, 0, 0);
    const items = report.items;
    autoTable(doc, {
      startY: y + 4,
      head: [
        ['N°', 'Habilidad / contenido', 'Clave', 'Dificultad', 'Discrim.', 'Distractor', 'Alertas'],
      ],
      body: items.map((i) => [
        String(i.position),
        i.skillName ?? i.contentName ?? '—',
        i.correctKey ?? '—',
        i.difficulty === null ? '—' : `${i.difficulty.toFixed(0)}%`,
        fmtNum(i.discrimination, 2),
        i.topDistractorKey
          ? `${i.topDistractorKey}${i.topDistractorRate !== null ? ` (${i.topDistractorRate.toFixed(0)}%)` : ''}`
          : '—',
        i.flags.map((f) => FLAG_LABELS[f]).join(', ') || '—',
      ]),
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: HEAD },
      columnStyles: {
        0: { halign: 'center', cellWidth: 10 },
        2: { halign: 'center', cellWidth: 12 },
        3: { halign: 'right', cellWidth: 18 },
        4: { halign: 'right', cellWidth: 16 },
      },
      didParseCell: (data: CellHookData) => {
        if (data.section !== 'body') return;
        const item = items[data.row.index];
        if (!item) return;
        if (data.column.index === 3) {
          data.cell.styles.textColor = difficultyColor(item.difficulty);
          data.cell.styles.fontStyle = 'bold';
        } else if (data.column.index === 4) {
          data.cell.styles.textColor = discriminationColor(item.discrimination);
          data.cell.styles.fontStyle = 'bold';
        } else if (data.column.index === 6 && item.flags.includes('critical')) {
          data.cell.styles.textColor = RED;
        }
      },
    });
  }

  // Alumnos en foco.
  if (report.studentsAtRisk.length) {
    y = sectionTitle(doc, 'Alumnos en foco de intervención', lastY(doc) + 8, marginX);
    const risk = report.studentsAtRisk;
    autoTable(doc, {
      startY: y,
      head: [['Alumno', 'RUT', 'Curso', '% Logro', 'Nivel', 'Habilidad más débil']],
      body: risk.map((s) => [
        s.studentFullName,
        s.studentRut,
        s.classGroupName ?? '—',
        fmtPct(s.achievement),
        performanceLevelLabel(s.performanceLevel),
        s.weakestSkill ?? '—',
      ]),
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: HEAD },
      columnStyles: { 3: { halign: 'right' } },
      didParseCell: (data: CellHookData) => {
        if (data.section === 'body' && data.column.index === 4) {
          const level = risk[data.row.index]?.performanceLevel;
          if (level) {
            data.cell.styles.fillColor = LEVEL_FILL[level];
            data.cell.styles.textColor = LEVEL_TEXT[level];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      },
    });
  }

  // Recomendaciones.
  if (report.recommendations.length) {
    y = sectionTitle(doc, 'Recomendaciones', lastY(doc) + 8, marginX);
    const recs = report.recommendations;
    autoTable(doc, {
      startY: y,
      head: [['Prioridad', 'Recomendación']],
      body: recs.map((r) => [PRIORITY_LABELS[r.priority], r.message]),
      styles: { fontSize: 9, cellPadding: 2, valign: 'top' },
      headStyles: { fillColor: HEAD },
      columnStyles: { 0: { cellWidth: 22, halign: 'center' } },
      didParseCell: (data: CellHookData) => {
        if (data.section === 'body' && data.column.index === 0) {
          const p = recs[data.row.index]?.priority;
          if (!p) return;
          data.cell.styles.fillColor = PRIORITY_FILL[p];
          data.cell.styles.textColor = PRIORITY_TEXT[p];
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });
  }

  // Pie de página con numeración.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Página ${p} de ${pages}`, pageW - marginX, doc.internal.pageSize.getHeight() - 8, {
      align: 'right',
    });
  }

  doc.save(`${base}.pdf`);
}

/** Título de sección con salto de página si no cabe. Devuelve la y para la tabla. */
function sectionTitle(doc: jsPDF, title: string, y: number, marginX: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  let top = y;
  if (top > pageH - 30) {
    doc.addPage();
    top = 18;
  }
  doc.setFontSize(12);
  doc.setTextColor(17, 24, 39);
  doc.text(title, marginX, top);
  doc.setTextColor(0, 0, 0);
  return top + 3;
}

/** finalY de la última tabla dibujada por autoTable. */
function lastY(doc: jsPDF): number {
  const withTable = doc as unknown as { lastAutoTable?: { finalY?: number } };
  return withTable.lastAutoTable?.finalY ?? 36;
}
