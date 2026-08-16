import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Block, BlockType } from '@soe/types';
import { headingBlockDefinition } from './blocks/heading-block';
import { textBlockDefinition } from './blocks/text-block';
import { listBlockDefinition } from './blocks/list-block';
import { calloutBlockDefinition } from './blocks/callout-block';
import { itemBlockDefinition } from './blocks/item-block';
import { imageBlockDefinition } from './blocks/image-block';
import { dividerBlockDefinition } from './blocks/divider-block';
import { spacerBlockDefinition } from './blocks/spacer-block';
import { activityBlockDefinition } from './blocks/activity-block';

export type DocumentAudience = 'teacher' | 'student';

export interface BlockEditProps<B extends Block = Block> {
  block: B;
  onChange: (block: B) => void;
  /** URLs resueltas por fileId (bloques `image`). */
  assets?: Record<string, string>;
  /**
   * Slot del host para editar el CONTENIDO de un ítem referenciado (bloques
   * `item`). El motor no sabe de dominio: el host decide qué hacer (abrir el
   * diálogo de copy-on-write). Sin callback, el EditView no ofrece la acción.
   */
  onEditItem?: (block: Extract<Block, { type: 'item' }>) => void;
}

export interface BlockViewProps<B extends Block = Block> {
  block: B;
  audience: DocumentAudience;
  /** URLs resueltas por fileId (bloques `image`). */
  assets?: Record<string, string>;
  /** Numeración correlativa de pregunta; la asigna el renderer solo a bloques `item`. */
  itemNumber?: number;
}

export interface BlockDefinition<B extends Block = Block> {
  label: string;
  icon: LucideIcon;
  makeDefault: () => B;
  EditView: ComponentType<BlockEditProps<B>>;
  PrintView: ComponentType<BlockViewProps<B>>;
}

export type BlockOfType<T extends BlockType> = Extract<Block, { type: T }>;

export const BLOCK_REGISTRY = {
  heading: headingBlockDefinition,
  text: textBlockDefinition,
  list: listBlockDefinition,
  callout: calloutBlockDefinition,
  item: itemBlockDefinition,
  image: imageBlockDefinition,
  divider: dividerBlockDefinition,
  spacer: spacerBlockDefinition,
  activity: activityBlockDefinition,
} satisfies { [T in BlockType]: BlockDefinition<BlockOfType<T>> };

export const BLOCK_TYPE_ORDER: readonly BlockType[] = [
  'heading',
  'text',
  'list',
  'callout',
  'item',
  'image',
  'divider',
  'spacer',
  'activity',
];

// TS no rastrea la correlación type→bloque al indexar con la unión; este es el
// único punto donde se borra el genérico del registro.
export function getBlockDefinition(type: BlockType): BlockDefinition {
  return BLOCK_REGISTRY[type] as unknown as BlockDefinition;
}
