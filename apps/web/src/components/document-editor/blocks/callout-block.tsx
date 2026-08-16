import { Megaphone } from 'lucide-react';
import type { CalloutBlock } from '@soe/types';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCallout, type CalloutTone } from '@/components/shared';
import { Markdown } from '@/components/shared/markdown';
import type { BlockDefinition, BlockEditProps, BlockViewProps } from '../block-registry';

type BlockTone = CalloutBlock['tone'];

const TONE_LABELS: Record<BlockTone, string> = {
  info: 'Información',
  tip: 'Consejo',
  warning: 'Atención',
};

const TONE_TO_CALLOUT: Record<BlockTone, CalloutTone> = {
  info: 'info',
  tip: 'success',
  warning: 'warning',
};

const TONES: readonly BlockTone[] = ['info', 'tip', 'warning'];

function parseTone(value: string): BlockTone {
  return value === 'tip' ? 'tip' : value === 'warning' ? 'warning' : 'info';
}

function CalloutEditView({ block, onChange }: BlockEditProps<CalloutBlock>) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={block.tone}
          onValueChange={(value) => onChange({ ...block, tone: parseTone(value) })}
        >
          <SelectTrigger className="w-36 shrink-0" aria-label="Tono del aviso">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TONES.map((tone) => (
              <SelectItem key={tone} value={tone}>
                {TONE_LABELS[tone]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={block.title ?? ''}
          placeholder="Título (opcional)"
          aria-label="Título del aviso"
          className="min-w-48 flex-1"
          onChange={(event) =>
            onChange({ ...block, title: event.target.value || undefined })
          }
        />
      </div>
      <Textarea
        value={block.markdown}
        rows={3}
        placeholder="Contenido del aviso…"
        aria-label="Contenido del aviso"
        onChange={(event) => onChange({ ...block, markdown: event.target.value })}
      />
      <p className="text-xs text-muted-foreground">Soporta Markdown.</p>
    </div>
  );
}

function CalloutPrintView({ block }: BlockViewProps<CalloutBlock>) {
  if (!block.markdown.trim() && !block.title?.trim()) return null;
  return (
    <AlertCallout tone={TONE_TO_CALLOUT[block.tone]} title={block.title}>
      {block.markdown.trim() ? <Markdown>{block.markdown}</Markdown> : null}
    </AlertCallout>
  );
}

export const calloutBlockDefinition: BlockDefinition<CalloutBlock> = {
  label: 'Aviso',
  icon: Megaphone,
  makeDefault: () => ({ id: crypto.randomUUID(), type: 'callout', tone: 'info', markdown: '' }),
  EditView: CalloutEditView,
  PrintView: CalloutPrintView,
};
