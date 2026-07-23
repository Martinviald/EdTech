'use client';

import { useMemo, useState, type JSX } from 'react';
import { ChevronRight } from 'lucide-react';
import type { SkillAchievementModel } from '@soe/types';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
}: {
  skills: SkillAchievementModel[];
  /** Filtros base del dashboard: fijan el peldaño inicial del drill-down. */
  filters?: DrilldownBaseFilters;
  assessmentId?: string;
}): JSX.Element {
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

      <div className="space-y-3">
        {visibleSkills.map((skill) => (
          <SkillRow key={skill.nodeId} skill={skill} onOpen={() => openDrilldown(skill)} />
        ))}
      </div>

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
  onOpen,
}: {
  skill: SkillAchievementModel;
  onOpen: () => void;
}): JSX.Element {
  const pct = skill.averageAchievement ?? 0;
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
              <span className="text-sm font-semibold tabular-nums">
                {formatAchievement(skill.averageAchievement)}
              </span>
              <PerformanceBadge level={skill.performanceLevel} band={skill.performanceBand} />
            </div>
          </div>

          <div
            className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={Math.round(pct)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Logro de ${skill.nodeName}`}
          >
            <div
              className={cn('h-full rounded-full transition-[width] motion-reduce:transition-none', barClass)}
              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
            />
          </div>
        </button>
      </CardContent>
    </Card>
  );
}
