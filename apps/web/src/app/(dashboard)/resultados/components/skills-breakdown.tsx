'use client';

import { useMemo, useState, type JSX } from 'react';
import { ChevronRight } from 'lucide-react';
import type { SampleSkillStat, SkillAchievementModel, SkillSampleReference } from '@soe/types';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { SampleComparisonLines } from '@/components/shared/sample-contrast';
import { useTelemetry } from '@/lib/telemetry';
import { cn } from '@/lib/utils';
import { formatNodeCode, nodeTypeLabel } from '@/lib/taxonomy-labels';
import { PerformanceBadge } from './performance-badge';
import { PERFORMANCE_LEVEL_BAR_CLASS, formatAchievement } from './performance-level';
import {
  SkillDrilldownDialog,
  type DrilldownNode,
  type DrilldownBaseFilters,
} from './skill-drilldown-dialog';

// ─────────────────────────────────────────────────────────────────────────────
// TKT-11 — Dropdown de dimensión de análisis (habilidad / contenido / OA / eje…).
// TKT-10 — Cada fila es interactiva: abre el drill-down jerárquico del logro.
//
// El backend (`/dashboards/skills`) ya devuelve TODOS los nodos evaluados con su
// `nodeType`; agrupar por dimensión es filtrar por ese tipo en cliente. El
// drill-down (`SkillDrilldownDialog`) desglosa el % del nodo por Asignatura →
// Nivel → Curso → Evaluación → Pregunta, arrancando en el peldaño por debajo de
// lo que ya fijan los filtros. Funciona tanto en la vista agregada como con una
// evaluación en contexto (`assessmentId` ⇒ arranca directo en preguntas).
// ─────────────────────────────────────────────────────────────────────────────

/** Sentinela para "todas las dimensiones" (Radix Select no admite value vacío). */
const ALL = '__all__';

/** Logro de la muestra de colegios por nodo (benchmarking en contexto). */
export type SkillsSample = {
  label: string;
  sizeLabel: string;
  skills: SampleSkillStat[];
};

/**
 * Referencias por nodo de una evaluación (docs/diseno-logro-unificado-y-cohorte.md §5.4): el %
 * del nivel completo (sólo cuando el grupo es un curso) y la muestra de colegios sobre las
 * preguntas del nodo que el grupo tiene corregidas.
 */
export type SkillComparison = {
  groupLabel: string;
  levelByNode: ReadonlyMap<string, number | null> | null;
  sampleByNode: ReadonlyMap<string, SkillSampleReference> | null;
  sampleMeta: { instrumentId: string; label: string; refreshedAt: string } | null;
};

const SAMPLE_SURFACE = 'skills_breakdown';

/** Orden de relevancia de las dimensiones en el dropdown. */
const DIMENSION_ORDER = [
  'skill',
  'content',
  'learning_objective',
  'text_type',
  'axis',
  'domain',
  'subdomain',
];

function dimensionRank(type: string): number {
  const i = DIMENSION_ORDER.indexOf(type);
  return i === -1 ? DIMENSION_ORDER.length : i;
}

export function SkillsBreakdown({
  skills,
  filters,
  assessmentId,
  sample,
  comparison,
}: {
  skills: SkillAchievementModel[];
  /** Filtros base del dashboard: fijan el peldaño inicial del drill-down. */
  filters?: DrilldownBaseFilters;
  assessmentId?: string;
  sample?: SkillsSample | null;
  /** Con una evaluación en contexto: nivel y muestra sobre las mismas preguntas. Tiene precedencia sobre `sample`. */
  comparison?: SkillComparison | null;
}): JSX.Element {
  const sampleByNode = useMemo(
    () => new Map((sample?.skills ?? []).map((skill) => [skill.nodeId, skill])),
    [sample],
  );
  // Dimensiones (nodeType) presentes en los datos, ordenadas por relevancia.
  const dimensions = useMemo(() => {
    const set = new Set(skills.map((s) => s.nodeType));
    return Array.from(set).sort((a, b) => dimensionRank(a) - dimensionRank(b));
  }, [skills]);

  // Por defecto, la primera dimensión disponible (si hay una sola, se fija).
  const [dimension, setDimension] = useState<string>(() => dimensions[0] ?? ALL);

  const [activeNode, setActiveNode] = useState<DrilldownNode | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const visibleSkills = useMemo(() => {
    if (dimension === ALL) return skills;
    return skills.filter((s) => s.nodeType === dimension);
  }, [skills, dimension]);

  const openDrilldown = (skill: SkillAchievementModel): void => {
    setActiveNode({
      nodeId: skill.nodeId,
      nodeName: skill.nodeName,
      nodeType: skill.nodeType,
      nodeCode: skill.nodeCode,
    });
    setDialogOpen(true);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Agrupar por:</span>
        <Select value={dimension} onValueChange={setDimension}>
          <SelectTrigger className="w-[220px]" aria-label="Dimensión de análisis">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {dimensions.length > 1 ? (
              <SelectItem value={ALL}>Todas las dimensiones</SelectItem>
            ) : null}
            {dimensions.map((type) => (
              <SelectItem key={type} value={type}>
                {nodeTypeLabel(type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <TooltipProvider delayDuration={150}>
        <div className="space-y-3">
          {visibleSkills.map((skill) => (
            <SkillRow
              key={skill.nodeId}
              skill={skill}
              sample={!comparison && sample ? sampleByNode.get(skill.nodeId) : undefined}
              sampleLabel={
                !comparison && sample ? `${sample.label} (${sample.sizeLabel})` : undefined
              }
              comparison={comparison ?? null}
              onOpen={() => openDrilldown(skill)}
            />
          ))}
        </div>
      </TooltipProvider>

      <SkillDrilldownDialog
        node={activeNode}
        filters={filters ?? {}}
        assessmentId={assessmentId}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}

function SkillRow({
  skill,
  sample,
  sampleLabel,
  comparison,
  onOpen,
}: {
  skill: SkillAchievementModel;
  sample?: SampleSkillStat;
  sampleLabel?: string;
  comparison: SkillComparison | null;
  onOpen: () => void;
}): JSX.Element {
  const { track } = useTelemetry();
  const pct = skill.averageAchievement ?? 0;
  const nodeSample = comparison?.sampleByNode?.get(skill.nodeId) ?? null;
  const levelPct = comparison?.levelByNode?.get(skill.nodeId) ?? null;
  const samplePct = nodeSample ? nodeSample.value : (sample?.achievement ?? null);
  const barClass = skill.performanceLevel
    ? PERFORMANCE_LEVEL_BAR_CLASS[skill.performanceLevel]
    : 'bg-muted-foreground/40';

  return (
    <Card>
      <CardContent className="p-0">
        <button
          type="button"
          onClick={onOpen}
          className="w-full space-y-3 rounded-lg p-4 text-left transition-colors hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring"
          aria-label={`Ver preguntas asociadas a ${skill.nodeName}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1 font-medium leading-tight">
                {skill.nodeName}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </p>
              <p className="text-xs text-muted-foreground">
                {[formatNodeCode(skill.nodeCode, skill.nodeType), nodeTypeLabel(skill.nodeType)]
                  .filter(Boolean)
                  .join(' · ')}
                {' · '}
                {skill.studentsAssessed} alumnos
              </p>
            </div>
            <div className="flex items-center gap-3">
              {nodeSample && comparison?.sampleMeta ? (
                <Tooltip
                  onOpenChange={(open) => {
                    if (open && comparison.sampleMeta) {
                      track('benchmark.sample_viewed', {
                        surface: SAMPLE_SURFACE,
                        instrumentId: comparison.sampleMeta.instrumentId,
                      });
                    }
                  }}
                >
                  <TooltipTrigger asChild>
                    <span className="text-xs text-muted-foreground underline decoration-dotted underline-offset-2 tabular-nums">
                      {levelPct !== null ? `Nivel ${formatAchievement(levelPct)} · ` : ''}
                      Muestra {formatAchievement(nodeSample.value)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="end" className="max-w-xs">
                    <SampleComparisonLines
                      lines={[
                        { label: comparison.groupLabel, value: skill.averageAchievement },
                        ...(comparison.levelByNode ? [{ label: 'Nivel', value: levelPct }] : []),
                      ]}
                      sample={{ ...nodeSample, refreshedAt: comparison.sampleMeta.refreshedAt }}
                      instrumentId={comparison.sampleMeta.instrumentId}
                      surface={SAMPLE_SURFACE}
                    />
                  </TooltipContent>
                </Tooltip>
              ) : levelPct !== null ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  Nivel {formatAchievement(levelPct)}
                </span>
              ) : samplePct !== null ? (
                <span className="text-xs text-muted-foreground tabular-nums" title={sampleLabel}>
                  Muestra {formatAchievement(samplePct)}
                </span>
              ) : null}
              <span className="text-sm font-semibold tabular-nums">
                {formatAchievement(skill.averageAchievement)}
              </span>
              <PerformanceBadge level={skill.performanceLevel} band={skill.performanceBand} />
            </div>
          </div>

          <div
            className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Logro de ${skill.nodeName}`}
          >
            <div
              className={cn(
                'h-full rounded-full transition-[width] motion-reduce:transition-none',
                barClass,
              )}
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
            {levelPct !== null ? (
              <div
                className="absolute inset-y-0 w-0.5 bg-primary/70"
                style={{ left: `${Math.min(100, Math.max(0, levelPct))}%` }}
                title={`Nivel ${formatAchievement(levelPct)}`}
                aria-hidden
              />
            ) : null}
            {samplePct !== null ? (
              <div
                className="absolute inset-y-0 w-0.5 bg-foreground/70"
                style={{ left: `${Math.min(100, Math.max(0, samplePct))}%` }}
                title={sampleLabel ?? `Muestra ${formatAchievement(samplePct)}`}
                aria-hidden
              />
            ) : null}
          </div>
        </button>
      </CardContent>
    </Card>
  );
}
