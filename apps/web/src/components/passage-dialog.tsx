'use client';

import type { JSX } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BookOpen, ImageOff } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// ─────────────────────────────────────────────────────────────────────────────
// Modal reutilizable para mostrar el TEXTO DE LECTURA (passage) y el material
// multimedia de una sección. Se usa en tres lugares: la lista de "Secciones" del
// banco de ítems, el panel de detalle de ítem (banco) y el panel de detalle de
// pregunta (resultados). Como es un Dialog (Radix, portal a body) se monta por
// encima de los `Sheet` laterales (que son `z-50`); el content va en `z-[60]`.
//
// Las figuras aún no tienen archivo en S3 (`section_attachments.url` = null):
// para esas se muestra un aviso "no disponible aún" en vez de una imagen rota.
// ─────────────────────────────────────────────────────────────────────────────

export type PassageAttachment = {
  kind: string; // image | audio | pdf | other
  url: string | null;
  fileName: string | null;
  mimeType: string | null;
  note: string | null;
};

export type PassageData = {
  sectionName?: string | null;
  passageTitle: string | null;
  passageText: string | null;
  passageFormat: string | null; // 'plain' | 'markdown' | 'html'
  attachments?: PassageAttachment[];
};

/** ¿La sección tiene algo que mostrar (texto o multimedia)? */
export function hasPassageContent(
  p:
    | { passageText: string | null; attachments?: readonly unknown[] | null }
    | null
    | undefined,
): boolean {
  if (!p) return false;
  return Boolean(p.passageText && p.passageText.trim()) || (p.attachments?.length ?? 0) > 0;
}

export function PassageDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  passage: PassageData | null;
}): JSX.Element {
  const { open, onOpenChange, passage } = props;
  const title =
    passage?.passageTitle?.trim() || passage?.sectionName?.trim() || 'Texto de lectura';
  const attachments = passage?.attachments ?? [];
  const hasText = Boolean(passage?.passageText && passage.passageText.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[60] max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader className="pr-8">
          <DialogTitle className="flex items-center gap-2 text-base leading-snug">
            <BookOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {title}
          </DialogTitle>
          <DialogDescription>
            {passage?.sectionName
              ? `Sección «${passage.sectionName}»`
              : 'Texto base y material asociado a la pregunta.'}
          </DialogDescription>
        </DialogHeader>

        {hasText ? (
          passage!.passageFormat === 'markdown' ? (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {passage!.passageText!}
              </ReactMarkdown>
            </div>
          ) : (
            <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
              {passage!.passageText}
            </p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">
            Esta sección no tiene texto de lectura registrado.
          </p>
        )}

        {attachments.length > 0 ? (
          <section className="space-y-2 border-t pt-4">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Material multimedia
            </h3>
            <ul className="space-y-3">
              {attachments.map((att, i) => (
                <li key={i}>
                  {att.url && att.kind === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={att.url}
                      alt={att.note ?? att.fileName ?? 'Figura de la sección'}
                      className="max-h-80 w-full rounded-md border object-contain"
                    />
                  ) : att.url ? (
                    <a
                      href={att.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-primary underline"
                    >
                      {att.fileName ?? att.note ?? 'Abrir archivo'}
                    </a>
                  ) : (
                    <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
                      <ImageOff className="size-4 shrink-0" aria-hidden />
                      <span>
                        {att.note ?? att.fileName ?? 'Figura'} — no disponible aún (archivo
                        no cargado).
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
