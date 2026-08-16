import type { Block, DocumentContent } from '@soe/types';
import { collectItemBlockIds, summarizeContent } from './documents.helpers';

function itemBlock(id: string, itemId: string): Block {
  return {
    id,
    type: 'item',
    itemId,
    showAnswer: false,
    snapshot: { type: 'multiple_choice', version: 1, content: {} },
  };
}

function headingBlock(id: string): Block {
  return { id, type: 'heading', level: 1, text: 'Título' };
}

function content(blocks: Block[]): DocumentContent {
  return { version: 1, blocks };
}

describe('collectItemBlockIds', () => {
  it('devuelve los itemId únicos preservando el orden de aparición', () => {
    const result = collectItemBlockIds(
      content([
        headingBlock('b1'),
        itemBlock('b2', 'item-1'),
        itemBlock('b3', 'item-2'),
        itemBlock('b4', 'item-1'),
        itemBlock('b5', 'item-3'),
      ]),
    );

    expect(result).toEqual(['item-1', 'item-2', 'item-3']);
  });

  it('devuelve [] cuando no hay bloques item', () => {
    const result = collectItemBlockIds(
      content([headingBlock('b1'), { id: 'b2', type: 'divider' }]),
    );

    expect(result).toEqual([]);
  });

  it('devuelve [] para un content vacío', () => {
    expect(collectItemBlockIds(content([]))).toEqual([]);
  });
});

describe('summarizeContent', () => {
  it('cuenta todos los bloques y los bloques item por separado', () => {
    const result = summarizeContent(
      content([
        headingBlock('b1'),
        itemBlock('b2', 'item-1'),
        itemBlock('b3', 'item-1'),
        { id: 'b4', type: 'spacer', size: 'md' },
      ]),
    );

    expect(result).toEqual({ blockCount: 4, itemCount: 2 });
  });

  it('devuelve ceros para un content vacío', () => {
    expect(summarizeContent(content([]))).toEqual({ blockCount: 0, itemCount: 0 });
  });
});
