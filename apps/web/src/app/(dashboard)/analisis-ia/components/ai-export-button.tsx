'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Export del análisis IA (H20.10) — informe consolidado (H20.11) en un archivo.
// Reusa el patrón de resultados/informe/report-export-button.tsx (paleta, dropdown,
// formateadores). NO hace fetch: opera sobre los datos ya cargados:
//   • AssessmentInsightsOutput (informe IA de la evaluación, S1)
//   • InstrumentQualityResponse (calidad determinista del instrumento, H20.9)
// Excel: un libro multi-hoja. PDF: un documento con secciones y la misma
// codificación de color de la pantalla (prioridad, banderas de calidad).
// ─────────────────────────────────────────────────────────────────────────────

import type { JSX } from 'react';
import { useState } from 'react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable, { type CellHookData } from 'jspdf-autotable';
import { FileDown } from 'lucide-react';
import type {
  AssessmentInsightsOutput,
  InstrumentQualityResponse,
  ItemQualityFlag,
} from '@soe/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { causeLabel, priorityLabel } from './format';
import { FLAG_LABELS } from './quality-format';

type RGB = [number, number, number];

const AMBER: RGB = [217, 119, 6];
const MUTED: RGB = [107, 114, 128];
const HEAD: RGB = [37, 99, 235];

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
const FLAG_FILL: Record<ItemQualityFlag, RGB> = {
  low_discrimination: [254, 226, 226],
  ambiguous_key: [254, 226, 226],
  strong_distractor: [254, 243, 199],
  too_easy: [243, 244, 246],
  misaligned: [254, 243, 199],
};
const FLAG_TEXT: Record<ItemQualityFlag, RGB> = {
  low_discrimination: [153, 27, 27],
  ambiguous_key: [153, 27, 27],
  strong_distractor: [146, 64, 14],
  too_easy: [55, 65, 81],
  misaligned: [146, 64, 14],
};

// ── Formateadores ─────────────────────────────────────────────────────────────

function fmtPct(value: number | null, digits = 0): string {
  if (value === null || Number.isNaN(value)) return '—';
  const pct = value <= 1 && value >= -1 ? value * 100 : value;
  return `${pct.toFixed(digits)}%`;
}
function fmtPctRaw(value: number | null, digits = 0): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}
function fmtNum(value: number | null, digits = 2): string {
  if (value === null || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}
function sanitize(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, ' ').trim();
}
function audienceLabel(audience: 'director' | 'teacher'): string {
  return audience === 'teacher' ? 'Profesor' : 'Directivo';
}

interface AiExportButtonProps {
  output: AssessmentInsightsOutput;
  quality: InstrumentQualityResponse | null;
  title: string;
}

export function AiExportButton({
  output,
  quality,
  title,
}: AiExportButtonProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const base = `analisis-ia-${sanitize(title)}`.slice(0, 80);

  function exportExcel() {
    setBusy(true);
    try {
      buildWorkbook(output, quality, title, base);
    } finally {
      setBusy(false);
    }
  }
  function exportPdf() {
    setBusy(true);
    try {
      buildPdf(output, quality, title, base);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="default" size="sm" disabled={busy}>
          <FileDown className="mr-2 size-4" aria-hidden />
          Exportar análisis
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={exportExcel}>
          Análisis IA en Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={exportPdf}>
          Análisis IA en PDF (.pdf)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function appendSheet(wb: XLSX.WorkBook, name: string, ws: XLSX.WorkSheet) {
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
}

// ── Excel ─────────────────────────────────────────────────────────────────────

function buildWorkbook(
  output: AssessmentInsightsOutput,
  quality: InstrumentQualityResponse | null,
  title: string,
  base: string,
) {
  const wb = XLSX.utils.book_new();

  // Hoja 1 — Resumen / narrativa.
  appendSheet(
    wb,
    'Resumen',
    XLSX.utils.aoa_to_sheet([
      ['Análisis IA'],
      [title],
      [],
      ['Titular'],
      [output.headline],
      [],
      ['Síntesis para la gestión'],
      [output.executiveSummary.director],
      [],
      ['Síntesis para el aula'],
      [output.executiveSummary.teacher],
      [],
      ['Confiabilidad (KR-20)', fmtNum(output.reliability.kr20)],
      ['Interpretación', output.reliability.interpretation],
      ['Confianza del análisis', fmtPct(output.confidence)],
      [],
      ['Límites del análisis', ...output.caveats],
    ]),
  );

  // Hoja 2 — Ítems destacados (Top 5).
  appendSheet(
    wb,
    'Ítems destacados',
    XLSX.utils.aoa_to_sheet([
      ['N°', 'Habilidad', 'Dificultad (p)', 'Discrim. (D)', 'Qué funcionó', 'Práctica replicable'],
      ...output.topItems.map((i) => [
        i.position,
        i.skillName ?? '—',
        fmtNum(i.difficulty),
        fmtNum(i.discrimination),
        i.whatWorked.join(' · '),
        i.replicableAction,
      ]),
    ]),
  );

  // Hoja 3 — Ítems críticos (Bottom 5).
  appendSheet(
    wb,
    'Ítems críticos',
    XLSX.utils.aoa_to_sheet([
      ['N°', 'Habilidad', 'Dificultad (p)', 'Causa probable', 'Misconcepción', 'Plan de acción'],
      ...output.bottomItems.map((i) => [
        i.position,
        i.skillName ?? '—',
        fmtNum(i.difficulty),
        causeLabel(i.likelyCause),
        i.misconception ?? '—',
        i.actionPlan.join(' · '),
      ]),
    ]),
  );

  // Hoja 4 — Brechas por habilidad.
  appendSheet(
    wb,
    'Brechas por habilidad',
    XLSX.utils.aoa_to_sheet([
      ['Habilidad', '% Logro', 'Hipótesis de causa raíz', 'Señal de misconcepción', 'Estrategia de reenseñanza', 'Actividad ejemplo', 'Grupo remedial'],
      ...output.skillGaps.map((s) => [
        s.nodeName,
        fmtPct(s.achievement),
        s.rootCauseHypothesis,
        s.misconceptionSignal ?? '—',
        s.reteachStrategy,
        s.exampleActivity,
        s.remedialGroupSize,
      ]),
    ]),
  );

  // Hoja 5 — Recomendaciones.
  appendSheet(
    wb,
    'Recomendaciones',
    XLSX.utils.aoa_to_sheet([
      ['Prioridad', 'Audiencia', 'Recomendación', 'Justificación', 'Acciones'],
      ...output.recommendations.map((r) => [
        priorityLabel(r.priority),
        audienceLabel(r.audience),
        r.title,
        r.rationale,
        r.suggestedActions.join(' · '),
      ]),
    ]),
  );

  // Hoja 6 — Calidad del instrumento (si está disponible).
  if (quality) {
    appendSheet(
      wb,
      'Calidad instrumento',
      XLSX.utils.aoa_to_sheet([
        ['Confiabilidad (KR-20)', fmtNum(quality.reliability.kr20)],
        ['Interpretación', quality.reliability.interpretation],
        ['Ítems analizados', quality.reliability.itemsAnalyzed],
        ['Alumnos analizados', quality.reliability.studentsAnalyzed],
        ['Ítems con alertas', quality.flaggedCount],
        [],
        ['N°', 'Habilidad/contenido', 'Clave', 'Dificultad (p%)', 'Discrim. (D)', 'P. biserial', 'Alertas', 'Sugerencias'],
        ...quality.items.map((i) => [
          i.position,
          i.skillName ?? i.contentName ?? '—',
          i.correctKey ?? '—',
          fmtPctRaw(i.difficulty),
          fmtNum(i.discrimination),
          fmtNum(i.pointBiserial),
          i.flags.map((f) => FLAG_LABELS[f]).join(', ') || '—',
          i.suggestions.join(' · ') || '—',
        ]),
      ]),
    );
  }

  XLSX.writeFile(wb, `${base}.xlsx`);
}

// ── PDF ───────────────────────────────────────────────────────────────────────

function buildPdf(
  output: AssessmentInsightsOutput,
  quality: InstrumentQualityResponse | null,
  title: string,
  base: string,
) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const marginX = 14;

  // Título.
  doc.setFontSize(16);
  doc.setTextColor(17, 24, 39);
  doc.text('Análisis IA de evaluación', marginX, 18);
  doc.setFontSize(11);
  doc.text(title, marginX, 25);
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(output.headline, marginX, 31, { maxWidth: pageW - marginX * 2 });
  doc.setTextColor(0, 0, 0);

  // Disclaimer.
  let y = 38;
  doc.setFontSize(8);
  doc.setTextColor(...AMBER);
  doc.text(
    'Sugerencia generada por IA — valida cada conclusión con tu criterio pedagógico antes de actuar.',
    marginX,
    y,
    { maxWidth: pageW - marginX * 2 },
  );
  doc.setTextColor(0, 0, 0);

  // Síntesis ejecutiva.
  y = sectionTitle(doc, 'Síntesis ejecutiva', y + 6, marginX);
  autoTable(doc, {
    startY: y,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 1.5, valign: 'top' },
    body: [
      ['Para la gestión', output.executiveSummary.director],
      ['Para el aula', output.executiveSummary.teacher],
    ],
    columnStyles: {
      0: { fontStyle: 'bold', textColor: MUTED, cellWidth: 34 },
    },
  });

  // Top 5.
  if (output.topItems.length) {
    y = sectionTitle(doc, 'Ítems destacados (Top 5)', lastY(doc) + 8, marginX);
    autoTable(doc, {
      startY: y,
      head: [['N°', 'Habilidad', 'p', 'D', 'Práctica replicable']],
      body: output.topItems.map((i) => [
        String(i.position),
        i.skillName ?? '—',
        fmtNum(i.difficulty),
        fmtNum(i.discrimination),
        i.replicableAction,
      ]),
      styles: { fontSize: 8, cellPadding: 1.5, valign: 'top' },
      headStyles: { fillColor: HEAD },
      columnStyles: {
        0: { halign: 'center', cellWidth: 9 },
        2: { halign: 'right', cellWidth: 14 },
        3: { halign: 'right', cellWidth: 14 },
      },
    });
  }

  // Bottom 5.
  if (output.bottomItems.length) {
    y = sectionTitle(doc, 'Ítems críticos (Bottom 5)', lastY(doc) + 8, marginX);
    autoTable(doc, {
      startY: y,
      head: [['N°', 'Habilidad', 'Causa probable', 'Misconcepción', 'Plan de acción']],
      body: output.bottomItems.map((i) => [
        String(i.position),
        i.skillName ?? '—',
        causeLabel(i.likelyCause),
        i.misconception ?? '—',
        i.actionPlan.join(' · '),
      ]),
      styles: { fontSize: 8, cellPadding: 1.5, valign: 'top' },
      headStyles: { fillColor: HEAD },
      columnStyles: { 0: { halign: 'center', cellWidth: 9 } },
    });
  }

  // Brechas.
  if (output.skillGaps.length) {
    y = sectionTitle(doc, 'Brechas por habilidad', lastY(doc) + 8, marginX);
    autoTable(doc, {
      startY: y,
      head: [['Habilidad', '% Logro', 'Causa raíz', 'Reenseñanza', 'Grupo']],
      body: output.skillGaps.map((s) => [
        s.nodeName,
        fmtPct(s.achievement),
        s.rootCauseHypothesis,
        s.reteachStrategy,
        String(s.remedialGroupSize),
      ]),
      styles: { fontSize: 8, cellPadding: 1.5, valign: 'top' },
      headStyles: { fillColor: HEAD },
      columnStyles: {
        1: { halign: 'right', cellWidth: 16 },
        4: { halign: 'right', cellWidth: 14 },
      },
    });
  }

  // Recomendaciones.
  if (output.recommendations.length) {
    y = sectionTitle(doc, 'Recomendaciones priorizadas', lastY(doc) + 8, marginX);
    const recs = output.recommendations;
    autoTable(doc, {
      startY: y,
      head: [['Prioridad', 'Audiencia', 'Recomendación']],
      body: recs.map((r) => [
        priorityLabel(r.priority),
        audienceLabel(r.audience),
        `${r.title}. ${r.rationale}`,
      ]),
      styles: { fontSize: 8, cellPadding: 2, valign: 'top' },
      headStyles: { fillColor: HEAD },
      columnStyles: {
        0: { cellWidth: 20, halign: 'center' },
        1: { cellWidth: 22, halign: 'center' },
      },
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

  // Calidad del instrumento.
  if (quality) {
    y = sectionTitle(doc, 'Calidad del instrumento', lastY(doc) + 8, marginX);
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(
      `KR-20: ${fmtNum(quality.reliability.kr20)} — ${quality.reliability.interpretation}`,
      marginX,
      y,
      { maxWidth: pageW - marginX * 2 },
    );
    doc.setTextColor(0, 0, 0);
    const qItems = quality.items;
    autoTable(doc, {
      startY: y + 5,
      head: [['N°', 'Habilidad/contenido', 'p%', 'D', 'P.bis', 'Alertas']],
      body: qItems.map((i) => [
        String(i.position),
        i.skillName ?? i.contentName ?? '—',
        i.difficulty === null ? '—' : `${i.difficulty.toFixed(0)}%`,
        fmtNum(i.discrimination),
        fmtNum(i.pointBiserial),
        i.flags.map((f) => FLAG_LABELS[f]).join(', ') || '—',
      ]),
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: HEAD },
      columnStyles: {
        0: { halign: 'center', cellWidth: 9 },
        2: { halign: 'right', cellWidth: 14 },
        3: { halign: 'right', cellWidth: 14 },
        4: { halign: 'right', cellWidth: 16 },
      },
      didParseCell: (data: CellHookData) => {
        if (data.section === 'body' && data.column.index === 5) {
          const flags = qItems[data.row.index]?.flags;
          const first = flags?.[0];
          if (first) {
            data.cell.styles.fillColor = FLAG_FILL[first];
            data.cell.styles.textColor = FLAG_TEXT[first];
          }
        }
      },
    });
  }

  // Límites del análisis.
  if (output.caveats.length) {
    y = sectionTitle(doc, 'Límites del análisis', lastY(doc) + 8, marginX);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(
      output.caveats.map((c) => `• ${c}`).join('\n'),
      marginX,
      y,
      { maxWidth: pageW - marginX * 2 },
    );
    doc.setTextColor(0, 0, 0);
  }

  // Pie con numeración.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(
      `Página ${p} de ${pages}`,
      pageW - marginX,
      doc.internal.pageSize.getHeight() - 8,
      { align: 'right' },
    );
  }

  doc.save(`${base}.pdf`);
}

function sectionTitle(doc: jsPDF, t: string, y: number, marginX: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  let top = y;
  if (top > pageH - 30) {
    doc.addPage();
    top = 18;
  }
  doc.setFontSize(12);
  doc.setTextColor(17, 24, 39);
  doc.text(t, marginX, top);
  doc.setTextColor(0, 0, 0);
  return top + 3;
}

function lastY(doc: jsPDF): number {
  const withTable = doc as unknown as { lastAutoTable?: { finalY?: number } };
  return withTable.lastAutoTable?.finalY ?? 36;
}
