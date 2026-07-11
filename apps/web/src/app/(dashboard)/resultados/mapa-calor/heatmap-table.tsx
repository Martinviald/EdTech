'use client';

// ─────────────────────────────────────────────────────────────────────────────
// H6.10 — Tabla del mapa de calor (FE-A). Filas = habilidades, columnas =
// asignaturas. Cada celda se colorea por rango de % logro usando los tokens
// Tailwind del nivel de desempeño (NO hex inline). Interactiva (tooltip por
// celda con alumnos evaluados) → client component.
// ─────────────────────────────────────────────────────────────────────────────

import type { JSX } from 'react';
import type { HeatmapResponse, PerformanceLevel } from '@soe/types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { PERFORMANCE_LEVEL_LABELS, formatAchievement } from '../components/performance-level';
import { cn } from '@/lib/utils';
import { formatNodeCode, nodeTypeLabel } from '@/lib/taxonomy-labels';

/**
 * Clases de fondo/texto de la celda por nivel de desempeño. La escala de calor
 * va de rojo (insuficiente) a azul (avanzado), consistente con el resto de la
 * app. Sin datos → fondo neutro. Todo via tokens Tailwind, sin hex inline.
 */
const HEAT_CELL_CLASS: Record<PerformanceLevel, string> = {
  insufficient: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100',
  elementary: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
  adequate: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
  advanced: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100',
};

const NO_DATA_CELL_CLASS = 'bg-muted/40 text-muted-foreground';

function heatCellClass(level: PerformanceLevel | null): string {
  return level ? HEAT_CELL_CLASS[level] : NO_DATA_CELL_CLASS;
}

export function HeatmapTable({ data }: { data: HeatmapResponse }) {
  const { subjects, rows } = data;

  return (
    <TooltipProvider delayDuration={150}>
      {/* scroll horizontal en móvil: la matriz puede tener muchas asignaturas */}
      <div className="w-full overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-10 bg-card min-w-[180px]">Habilidad</TableHead>
              {subjects.map((subject) => (
                <TableHead key={subject.subjectId} className="min-w-[96px] text-center">
                  {subject.subjectName}
                </TableHead>
              ))}
              <TableHead className="min-w-[88px] text-center font-semibold">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.nodeId}>
                <TableCell className="sticky left-0 z-10 bg-card align-top">
                  <span className="block font-medium leading-tight">{row.nodeName}</span>
                  {(row.nodeCode || row.nodeType) && (
                    <span className="block text-xs text-muted-foreground">
                      {[formatNodeCode(row.nodeCode, row.nodeType), nodeTypeLabel(row.nodeType)]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                </TableCell>

                {row.cells.map((cell) => (
                  <Tooltip key={`${row.nodeId}-${cell.subjectId}`}>
                    <TooltipTrigger asChild>
                      <TableCell
                        className={cn(
                          'text-center text-sm font-semibold tabular-nums',
                          heatCellClass(cell.performanceLevel),
                        )}
                      >
                        {formatAchievement(cell.averageAchievement)}
                      </TableCell>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="font-medium">{cellLevelLabel(cell.performanceLevel)}</p>
                      <p className="text-xs">
                        {cell.studentsAssessed === 0
                          ? 'Sin alumnos evaluados'
                          : `${cell.studentsAssessed} ${
                              cell.studentsAssessed === 1 ? 'alumno' : 'alumnos'
                            } evaluados`}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                ))}

                <Tooltip>
                  <TooltipTrigger asChild>
                    <TableCell
                      className={cn(
                        'text-center text-sm font-bold tabular-nums',
                        heatCellClass(row.overallPerformanceLevel),
                      )}
                    >
                      {formatAchievement(row.overallAchievement)}
                    </TableCell>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-medium">{cellLevelLabel(row.overallPerformanceLevel)}</p>
                    <p className="text-xs">Promedio en todas las asignaturas</p>
                  </TooltipContent>
                </Tooltip>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  );
}

function cellLevelLabel(level: PerformanceLevel | null): string {
  return level ? PERFORMANCE_LEVEL_LABELS[level] : 'Sin datos';
}

/** Leyenda de la escala de calor (un chip por nivel de desempeño). */
export function HeatmapLegend(): JSX.Element {
  const levels: PerformanceLevel[] = ['insufficient', 'elementary', 'adequate', 'advanced'];
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span className="font-medium">Escala de logro:</span>
      {levels.map((level) => (
        <span key={level} className="inline-flex items-center gap-1.5">
          <span
            className={cn('inline-block size-3 rounded-sm', HEAT_CELL_CLASS[level])}
            aria-hidden
          />
          {PERFORMANCE_LEVEL_LABELS[level]}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className={cn('inline-block size-3 rounded-sm', NO_DATA_CELL_CLASS)} aria-hidden />
        Sin datos
      </span>
    </div>
  );
}
