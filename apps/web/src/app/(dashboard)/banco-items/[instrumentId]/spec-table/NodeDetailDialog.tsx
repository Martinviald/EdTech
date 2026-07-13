'use client';

// Modal de detalle de un nodo de clasificación de la tabla de especificaciones.
// Los badges de la matriz muestran una forma corta (p. ej. "OA-3"); al hacer
// click, este modal despliega toda la info útil del nodo: tipo, código técnico,
// nombre completo y descripción. Los datos vienen del propio tag (`GET /items`
// ya expone `node.description`), sin fetch adicional.

import type { ItemTaxonomyTagModel } from '@soe/types';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { nodeTypeLabel, formatNodeCode } from '@/lib/taxonomy-labels';

export function NodeDetailDialog({
  tag,
  open,
  onClose,
}: {
  tag: ItemTaxonomyTagModel | null;
  open: boolean;
  onClose: () => void;
}) {
  const node = tag?.node;
  const typeLabel = node ? (nodeTypeLabel(node.type) ?? node.type) : null;
  const shortCode = node ? formatNodeCode(node.code, node.type) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-1.5">
            {typeLabel && (
              <Badge variant="secondary" className="text-[10px]">
                {typeLabel}
              </Badge>
            )}
            {shortCode && (
              <Badge variant="outline" className="font-mono text-[10px]">
                {shortCode}
              </Badge>
            )}
            {tag?.taggedBy === 'ai' && (
              <Badge variant="outline" className="text-[10px]">
                Etiquetado por IA
              </Badge>
            )}
          </div>
          <DialogTitle className="mt-2 text-base leading-snug">
            {node?.name ?? 'Nodo de clasificación'}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {node?.code ?? 'Detalle del nodo de clasificación.'}
          </DialogDescription>
        </DialogHeader>

        {node?.description ? (
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Descripción
            </h4>
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
              {node.description}
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
