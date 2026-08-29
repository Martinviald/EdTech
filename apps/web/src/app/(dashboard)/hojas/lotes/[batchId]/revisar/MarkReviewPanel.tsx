'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, CircleOff, ImageOff } from 'lucide-react';
import type { ReviewMarkModel } from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { AlertCallout } from '@/components/shared';
import { isMarkResolved, useResolveMark } from '../../../hooks/use-review-queue';
import { MARK_STATE_LABELS } from './review-labels';

const BLANK_VALUE = null;

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
      {children}
    </kbd>
  );
}

export function MarkReviewPanel({
  batchId,
  marks,
}: {
  batchId: string;
  marks: ReviewMarkModel[];
}) {
  const [index, setIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const resolveMark = useResolveMark(batchId);

  const safeIndex = Math.min(index, marks.length - 1);
  const current = marks[safeIndex];
  const resolvedCount = marks.filter(isMarkResolved).length;
  const allResolved = resolvedCount === marks.length;

  const focusPanel = useCallback(() => {
    containerRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    focusPanel();
  }, [focusPanel]);

  const findNextUnresolved = useCallback(
    (from: number, excludeMarkId: string | null): number | null => {
      const total = marks.length;
      for (let step = 1; step <= total; step += 1) {
        const i = (from + step) % total;
        const mark = marks[i];
        if (!mark) continue;
        if (mark.markId === excludeMarkId) continue;
        if (!isMarkResolved(mark)) return i;
      }
      return null;
    },
    [marks],
  );

  const goNext = useCallback(() => {
    const next = findNextUnresolved(safeIndex, null);
    if (next !== null) setIndex(next);
    focusPanel();
  }, [findNextUnresolved, safeIndex, focusPanel]);

  const goPrev = useCallback(() => {
    setIndex((prev) => Math.max(0, Math.min(prev, marks.length - 1) - 1));
    focusPanel();
  }, [marks.length, focusPanel]);

  const resolve = useCallback(
    (reviewedValue: string | null) => {
      if (!current) return;
      resolveMark.mutate({ markId: current.markId, reviewedValue });
      const next = findNextUnresolved(safeIndex, current.markId);
      if (next !== null) setIndex(next);
      focusPanel();
    },
    [current, resolveMark, findNextUnresolved, safeIndex, focusPanel],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!current) return;
      if (e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
        return;
      }
      const upper = e.key.toUpperCase();
      if (upper === '0' || (upper === 'B' && !current.options.includes('B'))) {
        e.preventDefault();
        resolve(BLANK_VALUE);
        return;
      }
      if (current.options.includes(upper)) {
        e.preventDefault();
        resolve(upper);
      }
    },
    [current, goNext, goPrev, resolve],
  );

  if (!current) return null;

  const currentResolved = isMarkResolved(current);
  const blankKeyLabel = current.options.includes('B') ? '0' : 'B / 0';

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            Marcas dudosas{' '}
            <span className="text-muted-foreground">
              ({resolvedCount} de {marks.length} revisadas)
            </span>
          </CardTitle>
          <p className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
            <Kbd>{current.options.join(' ')}</Kbd> alternativa · <Kbd>{blankKeyLabel}</Kbd> en
            blanco · <Kbd>Enter</Kbd> siguiente · <Kbd>←</Kbd> anterior
          </p>
        </div>
        <CardDescription>
          Mira el recorte y decide con una tecla. Cada decisión se guarda al instante y pasa a la
          siguiente marca.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {allResolved && (
          <AlertCallout tone="success" className="mb-4" title="Todas las marcas fueron revisadas">
            Puedes recorrerlas con las flechas para verificar, o confirmar el lote.
          </AlertCallout>
        )}

        <div
          ref={containerRef}
          tabIndex={0}
          role="group"
          aria-label={`Revisión de la marca ${safeIndex + 1} de ${marks.length}: pregunta ${current.printedNumber}`}
          onKeyDown={handleKeyDown}
          className="rounded-lg border p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium text-foreground">
                {current.studentName ?? 'Alumno sin identificar'}
              </span>
              <span className="text-muted-foreground">Pregunta {current.printedNumber}</span>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-medium',
                  current.state === 'multiple'
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-warning/10 text-warning',
                )}
              >
                {MARK_STATE_LABELS[current.state]}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {safeIndex + 1} de {marks.length}
            </span>
          </div>

          <div className="mt-4 grid gap-6 md:grid-cols-[1fr_auto]">
            <div className="flex min-h-48 items-center justify-center rounded-md border bg-muted/40 p-2">
              {current.cropUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={current.cropUrl}
                  alt={`Recorte de la marca de la pregunta ${current.printedNumber}`}
                  className="max-h-64 w-auto rounded bg-white"
                />
              ) : (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <ImageOff className="size-6" aria-hidden />
                  <span className="text-xs">Sin recorte disponible</span>
                </div>
              )}
            </div>

            <div className="flex flex-col justify-center gap-3">
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-2">
                {current.options.map((option) => {
                  const selected = currentResolved && current.reviewedValue === option;
                  return (
                    <Button
                      key={option}
                      type="button"
                      variant={selected ? 'default' : 'outline'}
                      size="lg"
                      className="h-14 min-w-16 text-lg font-semibold"
                      aria-label={`Marcar alternativa ${option}`}
                      aria-pressed={selected}
                      onClick={() => resolve(option)}
                    >
                      {option}
                    </Button>
                  );
                })}
              </div>
              <Button
                type="button"
                variant={
                  currentResolved && current.reviewedValue === null ? 'default' : 'outline'
                }
                aria-label="Marcar como en blanco"
                aria-pressed={currentResolved && current.reviewedValue === null}
                onClick={() => resolve(BLANK_VALUE)}
              >
                <CircleOff className="mr-2 size-4" aria-hidden />
                En blanco
              </Button>
              <p className="text-xs text-muted-foreground">
                Lectura de máquina: {current.value ?? 'sin valor'} · no se sobrescribe, tu
                decisión queda aparte.
              </p>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={goPrev}
              disabled={safeIndex === 0}
              aria-label="Ir a la marca anterior"
            >
              <ArrowLeft className="mr-2 size-4" aria-hidden />
              Anterior
            </Button>
            {currentResolved && (
              <span className="flex items-center gap-1.5 text-sm text-success">
                <CheckCircle2 className="size-4" aria-hidden />
                Resuelta
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={goNext}
              aria-label="Ir a la siguiente marca sin resolver"
            >
              Siguiente sin resolver
              <ArrowRight className="ml-2 size-4" aria-hidden />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
