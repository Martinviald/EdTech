'use client';

// ─────────────────────────────────────────────────────────────────────────────
// H6.9 — Exportar vista (FE-B). Serializa los datos YA cargados en la vista a
// Excel (xlsx) y PDF (jspdf + jspdf-autotable). NO hace fetch nuevo.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Download } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';

/**
 * Tabla genérica a exportar. Las filas son objetos planos cuyas claves son los
 * encabezados de columna. El componente sólo serializa: no conoce el dominio.
 */
export type ExportTable = {
  /** Encabezados en el orden deseado. */
  columns: string[];
  /** Filas como tuplas alineadas con `columns`. */
  rows: (string | number | null)[][];
};

export type ExportViewButtonProps = {
  /** Título del documento (aparece en la primera fila del PDF y nombre de hoja). */
  title: string;
  /** Subtítulo con los filtros aplicados (ej: "Lenguaje · 3° básico · DIA"). */
  subtitle?: string;
  /** Nombre base del archivo (sin extensión). */
  fileName: string;
  /** Tabla(s) a exportar. Cada una se vuelve una hoja en Excel y una tabla en PDF. */
  tables: { name: string; table: ExportTable }[];
};

export function ExportViewButton({
  title,
  subtitle,
  fileName,
  tables,
}: ExportViewButtonProps) {
  const [busy, setBusy] = useState(false);
  const hasData = tables.some((t) => t.table.rows.length > 0);

  function exportExcel() {
    setBusy(true);
    try {
      const wb = XLSX.utils.book_new();
      for (const { name, table } of tables) {
        const aoa: (string | number | null)[][] = [table.columns, ...table.rows];
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        // Nombre de hoja Excel: máx 31 chars, sin caracteres inválidos.
        const sheetName = name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Datos';
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
      }
      XLSX.writeFile(wb, `${fileName}.xlsx`);
    } finally {
      setBusy(false);
    }
  }

  function exportPdf() {
    setBusy(true);
    try {
      const doc = new jsPDF({ orientation: 'landscape' });
      doc.setFontSize(14);
      doc.text(title, 14, 16);
      let startY = 22;
      if (subtitle) {
        doc.setFontSize(10);
        doc.setTextColor(110);
        doc.text(subtitle, 14, 22);
        doc.setTextColor(0);
        startY = 28;
      }

      for (const { name, table } of tables) {
        doc.setFontSize(11);
        doc.text(name, 14, startY);
        autoTable(doc, {
          startY: startY + 3,
          head: [table.columns],
          body: table.rows.map((r) => r.map((c) => (c === null ? '—' : String(c)))),
          styles: { fontSize: 8 },
          headStyles: { fillColor: [37, 99, 235] },
        });
        // El plugin guarda la posición final en doc.lastAutoTable.
        const last = (doc as unknown as { lastAutoTable?: { finalY: number } })
          .lastAutoTable;
        startY = (last?.finalY ?? startY) + 12;
      }

      doc.save(`${fileName}.pdf`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={!hasData || busy}>
          <Download className="mr-2 size-4" aria-hidden />
          Exportar vista
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={exportExcel}>Exportar a Excel (.xlsx)</DropdownMenuItem>
        <DropdownMenuItem onSelect={exportPdf}>Exportar a PDF (.pdf)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
