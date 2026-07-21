'use client';

// ─────────────────────────────────────────────────────────────────────────────
// H6.18 — <ExportButton> genérico (FE-A). Serializa filas YA cargadas en la vista
// a Excel (xlsx) y PDF (jspdf + jspdf-autotable). NO hace fetch nuevo. Es
// reutilizable por cualquier vista (heatmap, tabla cruzada, etc.): recibe filas
// tipadas + definición de columnas y sólo serializa, sin conocer el dominio.
//
// Referencia de uso de las libs: resultados/components/charts/export-view-button.tsx
// (ese es específico de H6.9; este es la versión genérica del contrato §3.2).
// ─────────────────────────────────────────────────────────────────────────────

import type { JSX } from 'react';
import { useState } from 'react';
import { Download } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

/** Definición de una columna a exportar: clave del objeto fila + encabezado. */
export type ExportColumn<T> = { key: keyof T | string; header: string };

type ExportFormat = 'xlsx' | 'pdf';

const DEFAULT_FORMATS: ExportFormat[] = ['xlsx', 'pdf'];

/** Normaliza un valor de celda a algo serializable. `null`/`undefined` → ''. */
function cellValue(row: Record<string, unknown>, key: PropertyKey): string | number {
  const raw = row[key as keyof typeof row];
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'boolean') return raw ? 'Sí' : 'No';
  if (typeof raw === 'string') return raw;
  return String(raw);
}

export function ExportButton<T extends Record<string, unknown>>({
  rows,
  columns,
  filename,
  title,
  filtersSummary,
  formats = DEFAULT_FORMATS,
}: {
  /** Filas YA cargadas en la vista (no hace fetch nuevo). */
  rows: T[];
  columns: ExportColumn<T>[];
  /** Nombre base del archivo (sin extensión) y título del PDF. */
  filename: string;
  title: string;
  /** Texto con los filtros aplicados, para el subtítulo del PDF/hoja. */
  filtersSummary?: string;
  /** Formatos a ofrecer; por defecto ambos. */
  formats?: ExportFormat[];
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const hasData = rows.length > 0;
  const offered = formats.length > 0 ? formats : DEFAULT_FORMATS;

  async function exportExcel() {
    setBusy(true);
    try {
      const XLSX = await import('xlsx');
      // Construye objetos planos con los encabezados como claves para json_to_sheet.
      const data = rows.map((row) => {
        const record: Record<string, string | number> = {};
        for (const col of columns) {
          record[col.header] = cellValue(row, col.key);
        }
        return record;
      });
      const ws = XLSX.utils.json_to_sheet(data, {
        header: columns.map((c) => c.header),
      });
      const wb = XLSX.utils.book_new();
      const sheetName = title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Datos';
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
      XLSX.writeFile(wb, `${filename}.xlsx`);
    } finally {
      setBusy(false);
    }
  }

  async function exportPdf() {
    setBusy(true);
    try {
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = new jsPDF({ orientation: 'landscape' });
      doc.setFontSize(14);
      doc.text(title, 14, 16);
      let startY = 24;
      if (filtersSummary) {
        doc.setFontSize(10);
        doc.setTextColor(110);
        doc.text(filtersSummary, 14, 22);
        doc.setTextColor(0);
        startY = 28;
      }

      autoTable(doc, {
        startY,
        head: [columns.map((c) => c.header)],
        body: rows.map((row) =>
          columns.map((col) => {
            const v = cellValue(row, col.key);
            return v === '' ? '—' : String(v);
          }),
        ),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [37, 99, 235] },
      });

      doc.save(`${filename}.pdf`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={!hasData || busy}>
          <Download className="mr-2 size-4" aria-hidden />
          Exportar
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {offered.includes('xlsx') ? (
          <DropdownMenuItem onSelect={exportExcel}>Exportar a Excel (.xlsx)</DropdownMenuItem>
        ) : null}
        {offered.includes('pdf') ? (
          <DropdownMenuItem onSelect={exportPdf}>Exportar a PDF (.pdf)</DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
