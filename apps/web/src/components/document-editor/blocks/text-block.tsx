import { Text } from 'lucide-react';
import type { TextBlock } from '@soe/types';
import { Textarea } from '@/components/ui/textarea';
import { Markdown } from '@/components/shared/markdown';
import type { BlockDefinition, BlockEditProps, BlockViewProps } from '../block-registry';

function TextEditView({ block, onChange }: BlockEditProps<TextBlock>) {
  return (
    <div className="space-y-1.5">
      <Textarea
        value={block.markdown}
        rows={4}
        placeholder="Escribe el texto del documento…"
        aria-label="Texto del bloque"
        onChange={(event) => onChange({ ...block, markdown: event.target.value })}
      />
      <p className="text-xs text-muted-foreground">Soporta Markdown.</p>
    </div>
  );
}

function TextPrintView({ block }: BlockViewProps<TextBlock>) {
  if (!block.markdown.trim()) return null;
  return <Markdown>{block.markdown}</Markdown>;
}

export const textBlockDefinition: BlockDefinition<TextBlock> = {
  label: 'Texto',
  icon: Text,
  makeDefault: () => ({ id: crypto.randomUUID(), type: 'text', markdown: '' }),
  EditView: TextEditView,
  PrintView: TextPrintView,
};
