'use client';

import type { JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { RubricModel } from '@soe/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertCallout } from '@/components/shared';
import { apiClientGet } from '@/lib/api-client';
import { getDisplayMessage } from '@/lib/errors';

// ─────────────────────────────────────────────────────────────────────────────
// Modal de pauta (rúbrica) de un ítem. Fetchea `GET /rubrics/:id` on-demand al
// abrirse (TanStack Query) y renderiza la matriz de criterios × niveles. Cierra
// por overlay / X / Esc (comportamiento por defecto del Dialog de shadcn).
// ─────────────────────────────────────────────────────────────────────────────

const rubricKeys = {
  detail: (rubricId: string) => ['rubric', rubricId] as const,
};

export function RubricDialog({
  rubricId,
  open,
  onOpenChange,
}: {
  rubricId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const query = useQuery({
    queryKey: rubricKeys.detail(rubricId),
    queryFn: () => apiClientGet<RubricModel>(`/rubrics/${rubricId}`),
    enabled: open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{query.data?.name ?? 'Pauta de evaluación'}</DialogTitle>
          <DialogDescription>
            Criterios y niveles de logro con que se corrige esta pregunta.
          </DialogDescription>
        </DialogHeader>

        {query.isPending ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
            <Loader2 className="size-6 animate-spin" aria-hidden />
            <p className="text-sm">Cargando pauta…</p>
          </div>
        ) : query.isError ? (
          <AlertCallout tone="danger" title="No se pudo cargar la pauta">
            {getDisplayMessage(query.error, 'Intenta nuevamente en unos segundos.')}
          </AlertCallout>
        ) : query.data ? (
          <RubricBody rubric={query.data} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RubricBody({ rubric }: { rubric: RubricModel }): JSX.Element {
  if (rubric.criteria.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Esta pauta no tiene criterios registrados.</p>
    );
  }
  return (
    <div className="space-y-4">
      {rubric.criteria.map((criterion) => (
        <section key={criterion.id} className="rounded-lg border">
          <header className="flex items-start justify-between gap-3 border-b bg-muted/30 px-4 py-2.5">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{criterion.name}</h3>
              {criterion.description ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{criterion.description}</p>
              ) : null}
            </div>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {criterion.maxPoints} pts
            </span>
          </header>
          {criterion.levels.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">Sin niveles registrados.</p>
          ) : (
            <ul className="divide-y">
              {criterion.levels.map((level) => (
                <li key={level.id} className="flex gap-3 px-4 py-2.5 text-sm">
                  <span className="w-12 shrink-0 font-semibold tabular-nums text-foreground">
                    {level.score}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground">{level.descriptor}</p>
                    {level.examples && level.examples.length > 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Ejemplos: {level.examples.join(' · ')}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
