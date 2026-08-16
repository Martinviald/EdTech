import { List, ListOrdered } from 'lucide-react';
import type { ListBlock } from '@soe/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { BlockDefinition, BlockEditProps, BlockViewProps } from '../block-registry';

function ListEditView({ block, onChange }: BlockEditProps<ListBlock>) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant={block.style === 'bullet' ? 'secondary' : 'ghost'}
          icon={List}
          onClick={() => onChange({ ...block, style: 'bullet' })}
        >
          Viñetas
        </Button>
        <Button
          type="button"
          size="sm"
          variant={block.style === 'number' ? 'secondary' : 'ghost'}
          icon={ListOrdered}
          onClick={() => onChange({ ...block, style: 'number' })}
        >
          Numerada
        </Button>
      </div>
      <Textarea
        value={block.items.join('\n')}
        rows={4}
        placeholder="Un elemento por línea"
        aria-label="Elementos de la lista"
        onChange={(event) => onChange({ ...block, items: event.target.value.split('\n') })}
      />
    </div>
  );
}

function ListPrintView({ block }: BlockViewProps<ListBlock>) {
  const items = block.items.filter((item) => item.trim());
  if (items.length === 0) return null;
  const itemNodes = items.map((item, index) => <li key={index}>{item}</li>);
  return block.style === 'number' ? (
    <ol className="list-decimal space-y-1 pl-6">{itemNodes}</ol>
  ) : (
    <ul className="list-disc space-y-1 pl-6">{itemNodes}</ul>
  );
}

export const listBlockDefinition: BlockDefinition<ListBlock> = {
  label: 'Lista',
  icon: List,
  makeDefault: () => ({ id: crypto.randomUUID(), type: 'list', style: 'bullet', items: [] }),
  EditView: ListEditView,
  PrintView: ListPrintView,
};
