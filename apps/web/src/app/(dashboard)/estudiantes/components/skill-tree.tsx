'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, TrendingDown, TrendingUp } from 'lucide-react';
import type { StudentPanoramaSkillNode, StudentSkillTrendPoint } from '@soe/types';
import { PerformanceBadge } from '../../resultados/components/performance-badge';
import { formatAchievement } from '../../resultados/components/performance-level';
import { cn } from '@/lib/utils';
import { ProgressionChart, type ProgressionLine } from './progression-chart';

const NODE_TYPE_LABELS: Record<string, string> = {
  domain: 'Dominio',
  subdomain: 'Subdominio',
  axis: 'Eje',
  learning_objective: 'OA',
  skill: 'Habilidad',
  content: 'Contenido',
  text_type: 'Tipo de texto',
};

const TREND_UP_COLOR = 'hsl(var(--level-adequate))';
const TREND_DOWN_COLOR = 'hsl(var(--level-insufficient))';
const TREND_FLAT_COLOR = 'hsl(var(--muted-foreground))';

const COLUMN_COUNT = 6;

function hasEvaluatedChildren(node: StudentPanoramaSkillNode): boolean {
  return node.children.length > 0;
}

function hasTrend(node: StudentPanoramaSkillNode): boolean {
  return node.series.length >= 2;
}

type TrendDirection = 'up' | 'down' | 'flat';

function trendDirection(series: StudentSkillTrendPoint[]): TrendDirection {
  const withPct = series.filter((point) => point.achievement !== null);
  if (withPct.length < 2) return 'flat';
  const delta = withPct[withPct.length - 1]!.achievement! - withPct[0]!.achievement!;
  if (delta > 0.05) return 'up';
  if (delta < -0.05) return 'down';
  return 'flat';
}

const TREND_COLOR: Record<TrendDirection, string> = {
  up: TREND_UP_COLOR,
  down: TREND_DOWN_COLOR,
  flat: TREND_FLAT_COLOR,
};

function nodeLine(node: StudentPanoramaSkillNode): ProgressionLine {
  const direction = trendDirection(node.series);
  return {
    key: node.nodeId,
    label: node.nodeName,
    color: TREND_COLOR[direction],
    points: node.series.map((point) => ({ label: point.label, achievement: point.achievement })),
  };
}

function TrendCell({
  node,
  chartOpen,
  onToggleChart,
}: {
  node: StudentPanoramaSkillNode;
  chartOpen: boolean;
  onToggleChart: (nodeId: string) => void;
}) {
  if (!hasTrend(node)) {
    return <span className="text-muted-foreground">—</span>;
  }
  const direction = trendDirection(node.series);
  const TrendIcon = direction === 'down' ? TrendingDown : TrendingUp;
  const line = nodeLine(node);

  return (
    <button
      type="button"
      onClick={() => onToggleChart(node.nodeId)}
      aria-expanded={chartOpen}
      aria-label={
        chartOpen
          ? `Ocultar la progresión de ${node.nodeName}`
          : `Ver la progresión de ${node.nodeName}`
      }
      className="inline-flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/60"
    >
      <span className="pointer-events-none block h-8 w-20">
        <ProgressionChart lines={[line]} height={32} compact />
      </span>
      {direction !== 'flat' ? (
        <TrendIcon
          className={cn(
            'size-3.5 shrink-0',
            direction === 'up' ? 'text-level-adequate' : 'text-level-insufficient',
          )}
          aria-hidden
        />
      ) : null}
    </button>
  );
}

function SkillRow({
  node,
  depth,
  expanded,
  chartsOpen,
  onToggle,
  onToggleChart,
}: {
  node: StudentPanoramaSkillNode;
  depth: number;
  expanded: Set<string>;
  chartsOpen: Set<string>;
  onToggle: (nodeId: string) => void;
  onToggleChart: (nodeId: string) => void;
}) {
  const isOpen = expanded.has(node.nodeId);
  const expandable = hasEvaluatedChildren(node);
  const chartOpen = chartsOpen.has(node.nodeId);

  return (
    <>
      <tr className="border-b last:border-0">
        <td className="py-2 pr-4">
          <div className="flex items-start gap-1.5" style={{ paddingLeft: `${depth * 1.25}rem` }}>
            {expandable ? (
              <button
                type="button"
                onClick={() => onToggle(node.nodeId)}
                aria-expanded={isOpen}
                aria-label={isOpen ? `Contraer ${node.nodeName}` : `Expandir ${node.nodeName}`}
                className="mt-0.5 rounded text-muted-foreground hover:text-foreground"
              >
                {isOpen ? (
                  <ChevronDown className="size-4" aria-hidden />
                ) : (
                  <ChevronRight className="size-4" aria-hidden />
                )}
              </button>
            ) : (
              <span className="mt-0.5 size-4" aria-hidden />
            )}
            <span className="min-w-0">
              <span className={cn('font-medium', depth > 0 && 'font-normal')}>{node.nodeName}</span>
              {node.nodeCode ? (
                <span className="ml-1.5 text-xs text-muted-foreground">{node.nodeCode}</span>
              ) : null}
              <span className="ml-2 text-2xs uppercase tracking-wide text-muted-foreground">
                {NODE_TYPE_LABELS[node.nodeType] ?? node.nodeType}
              </span>
            </span>
          </div>
        </td>
        <td className="py-2 pr-4 tabular-nums">{node.assessmentsCount}</td>
        <td className="py-2 pr-4 tabular-nums text-muted-foreground">
          {node.correctCount}/{node.totalCount}
        </td>
        <td className="py-2 pr-4 tabular-nums">{formatAchievement(node.achievement)}</td>
        <td className="py-2 pr-4">
          <PerformanceBadge level={node.performanceLevel} />
        </td>
        <td className="py-2 pr-4">
          <TrendCell node={node} chartOpen={chartOpen} onToggleChart={onToggleChart} />
        </td>
      </tr>
      {chartOpen && hasTrend(node) ? (
        <tr className="border-b last:border-0">
          <td colSpan={COLUMN_COUNT} className="py-2 pr-4">
            <div
              className="rounded-lg border border-border bg-muted/30 p-3"
              style={{ marginLeft: `${depth * 1.25}rem` }}
            >
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Progresión de {node.nodeName}
              </p>
              <ProgressionChart lines={[nodeLine(node)]} height={176} />
            </div>
          </td>
        </tr>
      ) : null}
      {isOpen
        ? node.children.map((child) => (
            <SkillRow
              key={child.nodeId}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              chartsOpen={chartsOpen}
              onToggle={onToggle}
              onToggleChart={onToggleChart}
            />
          ))
        : null}
    </>
  );
}

export function SkillTree({ nodes }: { nodes: StudentPanoramaSkillNode[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [chartsOpen, setChartsOpen] = useState<Set<string>>(new Set());

  const toggle = (nodeId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const toggleChart = (nodeId: string) => {
    setChartsOpen((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const expandableIds = nodes.filter(hasEvaluatedChildren).map((n) => n.nodeId);
  const allOpen = expandableIds.length > 0 && expandableIds.every((id) => expanded.has(id));

  return (
    <div className="space-y-3">
      {expandableIds.length > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(allOpen ? new Set() : new Set(expandableIds))}
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {allOpen ? 'Contraer todo' : 'Expandir todo'}
        </button>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Eje / Habilidad / OA</th>
              <th className="py-2 pr-4 font-medium">Evaluaciones</th>
              <th className="py-2 pr-4 font-medium">Ítems</th>
              <th className="py-2 pr-4 font-medium">% logro</th>
              <th className="py-2 pr-4 font-medium">Nivel</th>
              <th className="py-2 pr-4 font-medium">Tendencia</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => (
              <SkillRow
                key={node.nodeId}
                node={node}
                depth={0}
                expanded={expanded}
                chartsOpen={chartsOpen}
                onToggle={toggle}
                onToggleChart={toggleChart}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
