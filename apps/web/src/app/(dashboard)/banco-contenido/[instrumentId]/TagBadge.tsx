import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatNodeCode } from '@/lib/taxonomy-labels';
import type { ItemTaxonomyTagModel } from '@soe/types';

const NODE_TYPE_COLORS: Record<string, string> = {
  learning_objective: 'bg-cat-1/15 text-cat-1',
  skill: 'bg-cat-2/15 text-cat-2',
  content: 'bg-cat-3/15 text-cat-3',
  axis: 'bg-cat-4/15 text-cat-4',
  domain: 'bg-cat-5/15 text-cat-5',
  descriptor: 'bg-cat-6/15 text-cat-6',
};

export function TagBadge({ tag }: { tag: ItemTaxonomyTagModel }) {
  const nodeType = tag.node?.type ?? 'unknown';
  const colorClass =
    NODE_TYPE_COLORS[nodeType] ?? 'bg-muted text-muted-foreground';
  const code = tag.node?.code;
  const name = tag.node?.name;
  // TKT-03: mostrar "OA-{n}"/nombre humano; el código técnico queda en el tooltip.
  const label = formatNodeCode(code, nodeType) ?? name ?? tag.nodeId.slice(0, 8);
  const tooltip = code && name ? `${code}: ${name}` : (name ?? '');

  return (
    <Badge
      variant="outline"
      title={tooltip}
      className={cn(
        'inline-block max-w-[15rem] whitespace-normal rounded-md border-0 py-1 text-left align-middle text-[10px] font-medium leading-snug',
        colorClass,
      )}
    >
      <span className="line-clamp-2">
        {label}
        {tag.taggedBy === 'ai' && (
          <span className="ml-1 opacity-60" title="Etiquetado por IA">
            IA
          </span>
        )}
      </span>
    </Badge>
  );
}
