'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { StudentPanoramaSkillNode } from '@soe/types';
import { PerformanceBadge } from '../../resultados/components/performance-badge';
import { formatAchievement } from '../../resultados/components/performance-level';
import { cn } from '@/lib/utils';

const NODE_TYPE_LABELS: Record<string, string> = {
  domain: 'Dominio',
  subdomain: 'Subdominio',
  axis: 'Eje',
  learning_objective: 'OA',
  skill: 'Habilidad',
  content: 'Contenido',
  text_type: 'Tipo de texto',
};

function hasEvaluatedChildren(node: StudentPanoramaSkillNode): boolean {
  return node.children.length > 0;
}

function SkillRow({
  node,
  depth,
  expanded,
  onToggle,
}: {
  node: StudentPanoramaSkillNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (nodeId: string) => void;
}) {
  const isOpen = expanded.has(node.nodeId);
  const expandable = hasEvaluatedChildren(node);

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
      </tr>
      {isOpen
        ? node.children.map((child) => (
            <SkillRow
              key={child.nodeId}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))
        : null}
    </>
  );
}

export function SkillTree({ nodes }: { nodes: StudentPanoramaSkillNode[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (nodeId: string) => {
    setExpanded((prev) => {
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
            </tr>
          </thead>
          <tbody>
            {nodes.map((node) => (
              <SkillRow
                key={node.nodeId}
                node={node}
                depth={0}
                expanded={expanded}
                onToggle={toggle}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
