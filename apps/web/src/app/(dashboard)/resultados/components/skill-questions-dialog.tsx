'use client';

import { useCallback, useEffect, useState, type JSX } from 'react';
import { BarChart3, Inbox, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { MatrixQuestionColumn, QuestionAnalysisResponse } from '@soe/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatNodeCode, nodeTypeLabel } from '@/lib/taxonomy-labels';
import { QuestionDetailPanel } from './question-detail-panel';
import { fetchNodeQuestions } from '../habilidades/actions';
import { fetchQuestionAnalysis } from '../detalle/actions';

// ─────────────────────────────────────────────────────────────────────────────
// TKT-10 — Drill-down "habilidad → preguntas asociadas" (modal reutilizable).
//
// Dado un nodo de taxonomía (habilidad/contenido/OA…) y una evaluación en
// contexto, lista las preguntas etiquetadas con ese nodo (vía la matriz filtrada
// por `nodeId`) y permite abrir el análisis de cada una reutilizando el
// `QuestionDetailPanel` (H6.12). Reutilizable donde haya una evaluación en
// contexto (hub por-evaluación e informe).
//
// Sin `assessmentId` (vista agregada cross-evaluación) no hay una matriz única
// que consultar: el modal lo explica en lugar de fallar.
// ─────────────────────────────────────────────────────────────────────────────

export type DrilldownNode = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  nodeCode: string | null;
};

function correctRateClass(rate: number | null): string {
  if (rate === null) return 'text-muted-foreground';
  if (rate < 40) return 'text-red-700 dark:text-red-300';
  if (rate < 60) return 'text-amber-700 dark:text-amber-300';
  return 'text-emerald-700 dark:text-emerald-300';
}

function formatPct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${value.toFixed(0)}%`;
}

export function SkillQuestionsDialog({
  node,
  assessmentId,
  classGroupId,
  open,
  onClose,
}: {
  node: DrilldownNode | null;
  assessmentId?: string;
  classGroupId?: string;
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const [loading, setLoading] = useState(false);
  const [questions, setQuestions] = useState<MatrixQuestionColumn[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Panel de detalle de una pregunta (anidado sobre el modal).
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<QuestionAnalysisResponse | null>(null);
  const [loadingItemId, setLoadingItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !node) return;
    if (!assessmentId) {
      setQuestions(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setQuestions(null);
    void fetchNodeQuestions({ assessmentId, nodeId: node.nodeId, classGroupId }).then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (result.ok) {
        setQuestions(result.questions);
      } else {
        setError(result.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, node, assessmentId, classGroupId]);

  const openQuestion = useCallback(
    async (column: MatrixQuestionColumn) => {
      setDetail(null);
      setDetailOpen(true);
      setLoadingItemId(column.itemId);
      const result = await fetchQuestionAnalysis({
        itemId: column.itemId,
        assessmentId,
        classGroupId,
      });
      setLoadingItemId((current) => {
        if (current !== column.itemId) return current;
        if (result.ok) {
          setDetail(result.data);
        } else {
          toast.error(result.message);
          setDetailOpen(false);
        }
        return null;
      });
    },
    [assessmentId, classGroupId],
  );

  const closeDetail = useCallback(() => {
    setDetailOpen(false);
    setDetail(null);
    setLoadingItemId(null);
  }, []);

  const codeLabel = node ? formatNodeCode(node.nodeCode, node.nodeType) : null;

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              {node ? <Badge variant="secondary">{nodeTypeLabel(node.nodeType)}</Badge> : null}
              {codeLabel ? <Badge variant="outline">{codeLabel}</Badge> : null}
            </div>
            <DialogTitle className="text-base leading-snug">
              {node ? node.nodeName : 'Preguntas asociadas'}
            </DialogTitle>
            <DialogDescription>
              Preguntas de la evaluación asociadas a este logro. Toca una para ver su distribución
              de respuestas y análisis de distractores.
            </DialogDescription>
          </DialogHeader>

          {!assessmentId ? (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
              <Inbox className="size-6" aria-hidden />
              <p>
                Selecciona una evaluación específica para ver las preguntas asociadas a este logro.
                En la vista agregada (varias evaluaciones) no hay un único conjunto de preguntas.
              </p>
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
              <Loader2 className="size-6 animate-spin" aria-hidden />
              <p className="text-sm">Cargando preguntas asociadas…</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
              <Inbox className="size-6" aria-hidden />
              <p>{error}</p>
            </div>
          ) : questions && questions.length > 0 ? (
            <ul className="space-y-2">
              {questions.map((q) => {
                const isLoading = loadingItemId === q.itemId;
                return (
                  <li key={q.itemId}>
                    <button
                      type="button"
                      onClick={() => void openQuestion(q)}
                      disabled={isLoading}
                      className="flex w-full items-center justify-between gap-3 rounded-md border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-70"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Badge variant="secondary" className="shrink-0 tabular-nums">
                          P{q.position}
                        </Badge>
                        <span className="truncate text-sm">
                          {q.skill?.nodeName ?? q.content?.nodeName ?? `Pregunta ${q.position}`}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span
                          className={cn(
                            'text-sm font-semibold tabular-nums',
                            correctRateClass(q.correctRate),
                          )}
                        >
                          {formatPct(q.correctRate)}
                        </span>
                        {isLoading ? (
                          <Loader2
                            className="size-4 animate-spin text-muted-foreground"
                            aria-hidden
                          />
                        ) : (
                          <BarChart3 className="size-4 text-muted-foreground" aria-hidden />
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
              <Inbox className="size-6" aria-hidden />
              <p>No se encontraron preguntas asociadas a este logro en la evaluación.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <QuestionDetailPanel data={detail} open={detailOpen} onClose={closeDetail} />
    </>
  );
}
