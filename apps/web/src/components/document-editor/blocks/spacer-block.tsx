import { MoveVertical } from 'lucide-react';
import type { SpacerBlock } from '@soe/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { BlockDefinition, BlockEditProps, BlockViewProps } from '../block-registry';

type SpacerSize = SpacerBlock['size'];

const SIZE_CLASS: Record<SpacerSize, string> = { sm: 'h-6', md: 'h-12', lg: 'h-20' };

const SIZE_LABELS: Record<SpacerSize, string> = {
  sm: 'Pequeño',
  md: 'Mediano',
  lg: 'Grande',
};

const SIZES: readonly SpacerSize[] = ['sm', 'md', 'lg'];

function parseSize(value: string): SpacerSize {
  return value === 'sm' ? 'sm' : value === 'lg' ? 'lg' : 'md';
}

function SpacerEditView({ block, onChange }: BlockEditProps<SpacerBlock>) {
  return (
    <div className="space-y-2">
      <div
        className={cn(
          'flex items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground',
          SIZE_CLASS[block.size],
        )}
      >
        Espacio
      </div>
      <Select
        value={block.size}
        onValueChange={(value) => onChange({ ...block, size: parseSize(value) })}
      >
        <SelectTrigger className="w-32" aria-label="Tamaño del espacio">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SIZES.map((size) => (
            <SelectItem key={size} value={size}>
              {SIZE_LABELS[size]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SpacerPrintView({ block }: BlockViewProps<SpacerBlock>) {
  return <div className={SIZE_CLASS[block.size]} aria-hidden />;
}

export const spacerBlockDefinition: BlockDefinition<SpacerBlock> = {
  label: 'Espacio',
  icon: MoveVertical,
  makeDefault: () => ({ id: crypto.randomUUID(), type: 'spacer', size: 'md' }),
  EditView: SpacerEditView,
  PrintView: SpacerPrintView,
};
