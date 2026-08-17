import { Heading1 } from 'lucide-react';
import type { HeadingBlock } from '@soe/types';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { BlockDefinition, BlockEditProps, BlockViewProps } from '../block-registry';

type HeadingLevel = HeadingBlock['level'];

const LEVEL_CLASS: Record<HeadingLevel, string> = {
  1: 'text-2xl font-bold tracking-tight',
  2: 'text-xl font-semibold tracking-tight',
  3: 'text-lg font-semibold',
};

const LEVEL_TAG: Record<HeadingLevel, 'h1' | 'h2' | 'h3'> = { 1: 'h1', 2: 'h2', 3: 'h3' };

function parseLevel(value: string): HeadingLevel {
  return value === '1' ? 1 : value === '2' ? 2 : 3;
}

function HeadingEditView({ block, onChange }: BlockEditProps<HeadingBlock>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={String(block.level)}
        onValueChange={(value) => onChange({ ...block, level: parseLevel(value) })}
      >
        <SelectTrigger className="w-28 shrink-0" aria-label="Nivel del título">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1">Título 1</SelectItem>
          <SelectItem value="2">Título 2</SelectItem>
          <SelectItem value="3">Título 3</SelectItem>
        </SelectContent>
      </Select>
      <Input
        value={block.text}
        placeholder="Texto del título"
        aria-label="Texto del título"
        className="min-w-48 flex-1 font-medium"
        onChange={(event) => onChange({ ...block, text: event.target.value })}
      />
    </div>
  );
}

function HeadingPrintView({ block }: BlockViewProps<HeadingBlock>) {
  if (!block.text.trim()) return null;
  const Tag = LEVEL_TAG[block.level];
  return <Tag className={LEVEL_CLASS[block.level]}>{block.text}</Tag>;
}

export const headingBlockDefinition: BlockDefinition<HeadingBlock> = {
  label: 'Título',
  icon: Heading1,
  makeDefault: () => ({ id: crypto.randomUUID(), type: 'heading', level: 2, text: '' }),
  EditView: HeadingEditView,
  PrintView: HeadingPrintView,
};
