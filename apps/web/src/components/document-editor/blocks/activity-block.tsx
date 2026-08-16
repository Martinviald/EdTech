import { ClipboardList } from 'lucide-react';
import type { ActivityBlock } from '@soe/types';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Markdown } from '@/components/shared/markdown';
import type { BlockDefinition, BlockEditProps, BlockViewProps } from '../block-registry';

function ActivityEditView({ block, onChange }: BlockEditProps<ActivityBlock>) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={block.title}
          placeholder="Título de la actividad"
          aria-label="Título de la actividad"
          className="min-w-48 flex-1"
          onChange={(event) => onChange({ ...block, title: event.target.value })}
        />
        <Input
          type="number"
          min={0}
          value={block.durationMin ?? ''}
          placeholder="Duración (min)"
          aria-label="Duración en minutos"
          className="w-36 shrink-0"
          onChange={(event) =>
            onChange({
              ...block,
              durationMin: event.target.value === '' ? null : Number(event.target.value),
            })
          }
        />
      </div>
      <Textarea
        value={block.description}
        rows={3}
        placeholder="Descripción de la actividad…"
        aria-label="Descripción de la actividad"
        onChange={(event) => onChange({ ...block, description: event.target.value })}
      />
      <p className="text-xs text-muted-foreground">Soporta Markdown.</p>
    </div>
  );
}

function ActivityPrintView({ block }: BlockViewProps<ActivityBlock>) {
  if (!block.title.trim() && !block.description.trim()) return null;
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{block.title.trim() ? block.title : 'Actividad'}</p>
        {block.durationMin !== null ? (
          <Badge variant="secondary">{block.durationMin} min</Badge>
        ) : null}
      </div>
      {block.description.trim() ? <Markdown>{block.description}</Markdown> : null}
    </div>
  );
}

export const activityBlockDefinition: BlockDefinition<ActivityBlock> = {
  label: 'Actividad',
  icon: ClipboardList,
  makeDefault: () => ({
    id: crypto.randomUUID(),
    type: 'activity',
    title: '',
    description: '',
    durationMin: null,
  }),
  EditView: ActivityEditView,
  PrintView: ActivityPrintView,
};
