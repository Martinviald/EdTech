import { Minus } from 'lucide-react';
import type { DividerBlock } from '@soe/types';
import type { BlockDefinition } from '../block-registry';

function DividerView() {
  return <hr className="border-border" />;
}

export const dividerBlockDefinition: BlockDefinition<DividerBlock> = {
  label: 'Separador',
  icon: Minus,
  makeDefault: () => ({ id: crypto.randomUUID(), type: 'divider' }),
  EditView: DividerView,
  PrintView: DividerView,
};
