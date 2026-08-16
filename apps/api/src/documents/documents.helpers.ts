import type { DocumentContent } from '@soe/types';

export function collectItemBlockIds(content: DocumentContent): string[] {
  const uniqueIds = new Set<string>();
  for (const block of content.blocks) {
    if (block.type === 'item') uniqueIds.add(block.itemId);
  }
  return [...uniqueIds];
}

export function summarizeContent(content: DocumentContent): {
  blockCount: number;
  itemCount: number;
} {
  let itemCount = 0;
  for (const block of content.blocks) {
    if (block.type === 'item') itemCount++;
  }
  return { blockCount: content.blocks.length, itemCount };
}
