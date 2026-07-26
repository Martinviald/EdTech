'use client';

// ─────────────────────────────────────────────────────────────────────────────
// H7.5 — Heatmap por habilidad: cada fila es una habilidad (nodo de taxonomía) y
// la celda se colorea según el `delta` (tu colegio − cohorte). Verde = sobre la
// cohorte, rojo = bajo, neutro ≈ a la par / sin dato. Interactivo (tooltip por
// fila) → client component. Colores via tokens Tailwind (sin hex inline).
// ─────────────────────────────────────────────────────────────────────────────

import type { JSX } from 'react';
import type { CohortSkillStat } from '@soe/types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatAchievement } from './band-presentation';
import { cn } from '@/lib/utils';

/** Umbral (puntos %) bajo el cual la diferencia se considera "a la par". */
const PAR_THRESHOLD = 2;

type DeltaTone = 'above' | 'below' | 'par' | 'none';

const DELTA_CELL_CLASS: Record<DeltaTone, string> = {
  above: 'bg-success/15 text-success',
  below: 'bg-destructive/15 text-destructive',
  par: 'bg-warning/15 text-warning',
  none: 'bg-muted/40 text-muted-foreground',
};

const DELTA_TONE_LABEL: Record<DeltaTone, string> = {
  above: 'Sobre la cohorte',
  below: 'Bajo la cohorte',
  par: 'A la par de la cohorte',
  none: 'Sin datos',
};

function deltaTone(delta: number | null): DeltaTone {
  if (delta === null || Number.isNaN(delta)) return 'none';
  if (delta > PAR_THRESHOLD) return 'above';
  if (delta < -PAR_THRESHOLD) return 'below';
  return 'par';
}

function formatDelta(delta: number | null): string {
  if (delta === null || Number.isNaN(delta)) return '—';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)} pts`;
}

export function SkillHeatmap({ perSkill }: { perSkill: CohortSkillStat[] }) {
  if (perSkill.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay datos por habilidad para esta comparación.
      </p>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-3">
        <div className="w-full overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-10 bg-card min-w-[200px]">
                  Habilidad
                </TableHead>
                <TableHead className="min-w-[110px] text-center">Tu colegio</TableHead>
                <TableHead className="min-w-[110px] text-center">Cohorte</TableHead>
                <TableHead className="min-w-[120px] text-center font-semibold">
                  Diferencia
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perSkill.map((skill) => {
                const tone = deltaTone(skill.delta);
                return (
                  <TableRow key={skill.nodeId}>
                    <TableCell className="sticky left-0 z-10 bg-card align-top font-medium leading-tight">
                      {skill.nodeName}
                    </TableCell>
                    <TableCell className="text-center text-sm tabular-nums">
                      {formatAchievement(skill.yourAchievement)}
                    </TableCell>
                    <TableCell className="text-center text-sm tabular-nums text-muted-foreground">
                      {formatAchievement(skill.cohortAchievement)}
                    </TableCell>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <TableCell
                          className={cn(
                            'text-center text-sm font-semibold tabular-nums',
                            DELTA_CELL_CLASS[tone],
                          )}
                        >
                          {formatDelta(skill.delta)}
                        </TableCell>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="font-medium">{DELTA_TONE_LABEL[tone]}</p>
                        <p className="text-xs">
                          Tu colegio − cohorte en {skill.nodeName}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <SkillHeatmapLegend />
      </div>
    </TooltipProvider>
  );
}

function SkillHeatmapLegend(): JSX.Element {
  const tones: DeltaTone[] = ['above', 'par', 'below', 'none'];
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span className="font-medium">Respecto a la cohorte:</span>
      {tones.map((tone) => (
        <span key={tone} className="inline-flex items-center gap-1.5">
          <span
            className={cn('inline-block size-3 rounded-sm', DELTA_CELL_CLASS[tone])}
            aria-hidden
          />
          {DELTA_TONE_LABEL[tone]}
        </span>
      ))}
    </div>
  );
}
