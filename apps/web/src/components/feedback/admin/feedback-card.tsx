'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertCircle, HelpCircle, Lightbulb, Loader2 } from 'lucide-react';
import {
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  FEEDBACK_TYPE_LABELS,
  type FeedbackAdminListItem,
  type FeedbackStatus,
  type FeedbackType,
} from '@soe/types';
import { apiClientPatch } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const TYPE_META: Record<
  FeedbackType,
  { icon: typeof AlertCircle; variant: 'destructive' | 'info' | 'warning' }
> = {
  bug: { icon: AlertCircle, variant: 'destructive' },
  idea: { icon: Lightbulb, variant: 'info' },
  confusion: { icon: HelpCircle, variant: 'warning' },
};

const STATUS_VARIANT: Record<FeedbackStatus, 'default' | 'secondary' | 'success' | 'outline'> = {
  new: 'default',
  triaged: 'secondary',
  planned: 'secondary',
  done: 'success',
  discarded: 'outline',
};

/**
 * Un comentario en la bandeja de plataforma.
 *
 * Se presenta como tarjeta y no como fila de tabla porque el contenido es prosa:
 * el mensaje es lo que hay que leer, y una celda lo obliga a truncarse. Alrededor
 * van los metadatos que el widget capturó solo —colegio, rol, vista, ruta— que es
 * lo que permite reproducir el problema sin escribirle a la persona.
 */
export function FeedbackCard({ item }: { item: FeedbackAdminListItem }) {
  const router = useRouter();
  const [note, setNote] = useState(item.internalNote ?? '');
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();

  const { icon: TypeIcon, variant: typeVariant } = TYPE_META[item.type];
  const noteChanged = note.trim() !== (item.internalNote ?? '').trim();

  const patch = async (body: Record<string, unknown>, okMessage: string) => {
    setSaving(true);
    try {
      await apiClientPatch(`/feedback/admin/${item.id}`, { orgId: item.orgId, ...body });
      toast.success(okMessage);
      // El listado es un Server Component: refrescarlo es lo que hace que el
      // cambio persista en pantalla y respete los filtros vigentes.
      startTransition(() => router.refresh());
    } catch {
      toast.error('No se pudo guardar el cambio.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="space-y-3 rounded-lg border border-border bg-card p-4">
      <header className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant={typeVariant} className="gap-1">
          <TypeIcon className="size-3" aria-hidden />
          {FEEDBACK_TYPE_LABELS[item.type]}
        </Badge>
        <Badge variant={STATUS_VARIANT[item.status]}>{FEEDBACK_STATUS_LABELS[item.status]}</Badge>
        <span className="font-medium text-foreground">{item.orgName}</span>
        <span aria-hidden>·</span>
        <span>{item.createdByName ?? 'Autor desconocido'}</span>
        {item.context.activeRole && (
          <>
            <span aria-hidden>·</span>
            <span>{item.context.activeRole}</span>
          </>
        )}
        <span aria-hidden>·</span>
        <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
      </header>

      <p className="whitespace-pre-wrap text-sm text-foreground">{item.message}</p>

      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {item.context.pageTitle && (
          <div className="flex gap-1">
            <dt className="font-medium">Vista:</dt>
            <dd>{item.context.pageTitle}</dd>
          </div>
        )}
        {item.context.path && (
          <div className="flex gap-1">
            <dt className="font-medium">Ruta:</dt>
            <dd className="font-mono">{item.context.path}</dd>
          </div>
        )}
        {item.context.viewport && (
          <div className="flex gap-1">
            <dt className="font-medium">Pantalla:</dt>
            <dd>
              {item.context.viewport.width}×{item.context.viewport.height}
            </dd>
          </div>
        )}
      </dl>

      {item.screenshotUrl && (
        <a
          href={item.screenshotUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-fit rounded border border-border transition hover:border-primary"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.screenshotUrl}
            alt={`Captura adjunta al comentario de ${item.orgName}`}
            className="max-h-40 rounded object-contain object-top"
          />
        </a>
      )}

      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
        <div className="w-44">
          <label className="mb-1 block text-xs font-medium" htmlFor={`status-${item.id}`}>
            Estado
          </label>
          <Select
            value={item.status}
            disabled={saving}
            onValueChange={(value) => void patch({ status: value }, 'Estado actualizado.')}
          >
            <SelectTrigger id={`status-${item.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FEEDBACK_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {FEEDBACK_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-56 flex-1">
          <label className="mb-1 block text-xs font-medium" htmlFor={`note-${item.id}`}>
            Nota interna
          </label>
          <Textarea
            id={`note-${item.id}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={saving}
            rows={2}
            maxLength={5000}
            placeholder="Sólo la ve el equipo de plataforma."
            className="resize-none"
          />
        </div>

        <Button
          variant="secondary"
          disabled={saving || !noteChanged}
          onClick={() => void patch({ internalNote: note }, 'Nota guardada.')}
        >
          {saving && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
          Guardar nota
        </Button>
      </div>
    </article>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
