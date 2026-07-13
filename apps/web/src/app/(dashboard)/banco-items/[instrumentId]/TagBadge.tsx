import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatNodeCode } from '@/lib/taxonomy-labels';
import type { ItemTaxonomyTagModel } from '@soe/types';

const NODE_TYPE_COLORS: Record<string, string> = {
  learning_objective: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
  skill: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200',
  content: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  axis: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200',
  domain: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
  descriptor: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200',
};

export function TagBadge({ tag }: { tag: ItemTaxonomyTagModel }) {
  const nodeType = tag.node?.type ?? 'unknown';
  const colorClass =
    NODE_TYPE_COLORS[nodeType] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-950 dark:text-gray-200';
  const code = tag.node?.code;
  const name = tag.node?.name;
  // TKT-03: mostrar "OA-{n}"/nombre humano; el código técnico queda en el tooltip.
  const label = formatNodeCode(code, nodeType) ?? name ?? tag.nodeId.slice(0, 8);
  const tooltip = code && name ? `${code}: ${name}` : (name ?? '');

  return (
    <Badge
      variant="outline"
      className={cn('border-0 text-[10px] font-medium', colorClass)}
      title={tooltip}
    >
      {label}
      {tag.taggedBy === 'ai' && (
        <span className="ml-1 opacity-60" title="Etiquetado por IA">
          IA
        </span>
      )}
    </Badge>
  );
}
