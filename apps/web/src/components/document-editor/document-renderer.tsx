'use client';

import type { DocumentContent } from '@soe/types';
import { cn } from '@/lib/utils';
import { getBlockDefinition, type DocumentAudience } from './block-registry';

interface DocumentRendererProps {
  content: DocumentContent;
  audience: DocumentAudience;
  assets?: Record<string, string>;
  className?: string;
}

/**
 * Vista de solo lectura del documento (preview del editor y ruta de impresión).
 * Sin hooks ni fetching: mapea bloques → PrintView del registro.
 */
export function DocumentRenderer({ content, audience, assets, className }: DocumentRendererProps) {
  let itemCount = 0;
  return (
    <div className={cn('mx-auto w-full max-w-3xl space-y-4', className)}>
      {content.blocks.map((block) => {
        const definition = getBlockDefinition(block.type);
        const itemNumber = block.type === 'item' ? ++itemCount : undefined;
        return (
          <definition.PrintView
            key={block.id}
            block={block}
            audience={audience}
            assets={assets}
            itemNumber={itemNumber}
          />
        );
      })}
    </div>
  );
}
