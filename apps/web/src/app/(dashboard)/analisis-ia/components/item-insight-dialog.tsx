'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Drill-down por-pregunta (H20.8). Modal que muestra el contexto del ítem
// (enunciado, pasaje, imagen) y embebe `ItemInsightInline` con `autoStart`, que
// gatilla la generación al abrir y hace el polling/render del análisis IA.
// ─────────────────────────────────────────────────────────────────────────────

import { Image as ImageIcon, Sparkles } from 'lucide-react';
import type { UserRole } from '@soe/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ItemInsightInline } from './item-insight-inline';

/** Datos mínimos del ítem para mostrar contexto (provistos por el padre). */
export interface ItemInsightTarget {
  itemId: string;
  position: number;
  skillName?: string | null;
  stem?: string | null;
  imageUrl?: string | null;
  passage?: { title: string | null; text: string | null } | null;
}

interface ItemInsightDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: ItemInsightTarget | null;
  assessmentId: string;
  classGroupId?: string;
  activeRole: UserRole;
}

export function ItemInsightDialog({
  open,
  onOpenChange,
  target,
  assessmentId,
  classGroupId,
  activeRole,
}: ItemInsightDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" aria-hidden />
            Análisis IA · Pregunta {target?.position ?? ''}
          </DialogTitle>
          <DialogDescription>
            {target?.skillName
              ? `Habilidad: ${target.skillName}`
              : 'Interpretación pedagógica de la pregunta a partir de métricas deterministas.'}
          </DialogDescription>
        </DialogHeader>

        {target ? <ItemContext target={target} /> : null}

        {target ? (
          <ItemInsightInline
            key={target.itemId}
            itemId={target.itemId}
            assessmentId={assessmentId}
            classGroupId={classGroupId}
            activeRole={activeRole}
            autoStart
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ItemContext({ target }: { target: ItemInsightTarget }) {
  const hasContent = target.stem || target.passage?.text || target.imageUrl;
  if (!hasContent) return null;
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
      {target.stem ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Enunciado
          </p>
          <p className="mt-1 text-sm text-foreground">{target.stem}</p>
        </div>
      ) : null}
      {target.passage?.text ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {target.passage.title ?? 'Pasaje asociado'}
          </p>
          <p className="mt-1 line-clamp-6 whitespace-pre-line text-sm text-muted-foreground">
            {target.passage.text}
          </p>
        </div>
      ) : null}
      {target.imageUrl ? (
        <div className="space-y-1">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <ImageIcon className="size-3.5" aria-hidden />
            Imagen del ítem
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={target.imageUrl}
            alt={`Imagen de la pregunta ${target.position}`}
            className="max-h-48 w-full rounded-md border bg-background object-contain"
          />
        </div>
      ) : null}
    </div>
  );
}
