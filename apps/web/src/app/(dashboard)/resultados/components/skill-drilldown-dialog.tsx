'use client';

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { BarChart3, ChevronRight, Home, Inbox, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { MatrixQuestionColumn, QuestionAnalysisResponse, SkillBreakdownRow } from '@soe/types';
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
import { PerformanceBadge } from './performance-badge';
import { PERFORMANCE_LEVEL_BAR_CLASS, formatAchievement } from './performance-level';
import { QuestionDetailPanel } from './question-detail-panel';
import {
  fetchNodeQuestions,
  fetchSkillBreakdown,
  type SkillBreakdownConstraints,
} from '../habilidades/actions';
import { fetchQuestionAnalysis } from '../detalle/actions';

// ─────────────────────────────────────────────────────────────────────────────
// TKT-10/TKT-11 — Drill-down jerárquico de un logro (habilidad/contenido/OA…).
//
// Escalera macro → micro: Asignatura → Nivel → Curso → Evaluación → Pregunta →
// [panel de detalle]. El punto de partida es el peldaño inmediatamente por debajo
// de la dimensión más profunda ya fijada por los filtros (p. ej. filtrado por
// nivel ⇒ arranca en Curso; llegando desde una evaluación ⇒ arranca en Pregunta).
// Cada click acota el siguiente peldaño. Los peldaños de una sola fila se saltan
// solos (una asignatura, un único curso…) para no obligar a un click muerto.
//
// El leaf "preguntas" reusa /item-analysis/matrix (nodeId + assessmentId) y el
// detalle reusa <QuestionDetailPanel> (H6.12). Este componente sustituye al
// antiguo SkillQuestionsDialog, que sólo sabía hacer el salto assessment→preguntas.
// ─────────────────────────────────────────────────────────────────────────────

export type DrilldownNode = {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  nodeCode: string | null;
};

/** Filtros base del dashboard que arrastra el drill-down (todos opcionales). */
export type DrilldownBaseFilters = {
  subjectId?: string;
  gradeId?: string;
  classGroupId?: string;
  studentId?: string;
  academicYearId?: string;
  instrumentType?: string;
};

const LADDER = ['subject', 'grade', 'classGroup', 'assessment', 'question'] as const;
type LadderLevel = (typeof LADDER)[number];
type BreakdownLevel = Exclude<LadderLevel, 'question'>;

type PathStep = { level: BreakdownLevel; id: string; label: string };

const LEVEL_PROMPT: Record<BreakdownLevel, string> = {
  subject: 'Toca una asignatura para seguir desglosando su logro.',
  grade: 'Toca un nivel para ver el logro de cada curso.',
  classGroup: 'Toca un curso para ver el logro de cada evaluación.',
  assessment: 'Toca una evaluación para ver el logro por pregunta.',
};

function correctRateClass(rate: number | null): string {
  if (rate === null) return 'text-muted-foreground';
  if (rate < 40) return 'text-destructive';
  if (rate < 60) return 'text-warning';
  return 'text-success';
}

function formatPct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${value.toFixed(0)}%`;
}

export function SkillDrilldownDialog({
  node,
  filters,
  assessmentId,
  open,
  onClose,
}: {
  node: DrilldownNode | null;
  filters: DrilldownBaseFilters;
  assessmentId?: string;
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  // Peldaño inicial: uno por debajo de la dimensión más profunda ya fijada.
  const startIndex = useMemo(() => {
    let deepest = -1;
    if (filters.subjectId) deepest = Math.max(deepest, 0);
    if (filters.gradeId) deepest = Math.max(deepest, 1);
    if (filters.classGroupId) deepest = Math.max(deepest, 2);
    if (assessmentId) deepest = Math.max(deepest, 3);
    return deepest + 1;
  }, [filters, assessmentId]);

  const [path, setPath] = useState<PathStep[]>([]);

  // Reiniciar la escalera al abrir o al cambiar de nodo.
  useEffect(() => {
    if (open) setPath([]);
  }, [open, node?.nodeId]);

  const currentIndex = Math.min(startIndex + path.length, LADDER.length - 1);
  const currentLevel: LadderLevel = LADDER[currentIndex] ?? 'question';

  // Restricciones acumuladas = filtros base + cada selección de la escalera.
  const constraints = useMemo<SkillBreakdownConstraints>(() => {
    const c: SkillBreakdownConstraints = {
      subjectId: filters.subjectId,
      gradeId: filters.gradeId,
      classGroupId: filters.classGroupId,
      studentId: filters.studentId,
      academicYearId: filters.academicYearId,
      instrumentType: filters.instrumentType,
      assessmentId,
    };
    for (const step of path) {
      if (step.level === 'subject') c.subjectId = step.id;
      else if (step.level === 'grade') c.gradeId = step.id;
      else if (step.level === 'classGroup') c.classGroupId = step.id;
      else if (step.level === 'assessment') c.assessmentId = step.id;
    }
    return c;
  }, [filters, assessmentId, path]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<SkillBreakdownRow[] | null>(null);
  const [questions, setQuestions] = useState<MatrixQuestionColumn[] | null>(null);

  // Panel de detalle de una pregunta (anidado sobre el modal).
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<QuestionAnalysisResponse | null>(null);
  const [loadingItemId, setLoadingItemId] = useState<string | null>(null);

  // Carga del peldaño actual: desglose (breakdown) o preguntas (leaf).
  useEffect(() => {
    if (!open || !node) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows(null);
    setQuestions(null);

    if (currentLevel === 'question') {
      const aId = constraints.assessmentId;
      if (!aId) {
        setLoading(false);
        setError('No hay una evaluación en contexto para mostrar sus preguntas.');
        return;
      }
      void fetchNodeQuestions({
        assessmentId: aId,
        nodeId: node.nodeId,
        classGroupId: constraints.classGroupId,
      }).then((res) => {
        if (cancelled) return;
        setLoading(false);
        if (res.ok) setQuestions(res.questions);
        else setError(res.message);
      });
    } else {
      void fetchSkillBreakdown({ nodeId: node.nodeId, groupBy: currentLevel, constraints }).then(
        (res) => {
          if (cancelled) return;
          if (!res.ok) {
            setLoading(false);
            setError(res.message);
            return;
          }
          const r = res.data.rows;
          // Auto-salto: un peldaño con una sola fila no aporta elección; bajamos
          // solos manteniendo el spinner hasta el nivel que sí discrimina.
          const only = r.length === 1 ? r[0] : undefined;
          if (only) {
            setPath((p) => [...p, { level: currentLevel, id: only.id, label: only.label }]);
            return;
          }
          setLoading(false);
          setRows(r);
        },
      );
    }

    return () => {
      cancelled = true;
    };
  }, [open, node, currentLevel, constraints]);

  const selectRow = useCallback(
    (row: SkillBreakdownRow) => {
      if (currentLevel === 'question') return;
      setPath((p) => [...p, { level: currentLevel, id: row.id, label: row.label }]);
    },
    [currentLevel],
  );

  const openQuestion = useCallback(
    async (column: MatrixQuestionColumn) => {
      setDetail(null);
      setDetailOpen(true);
      setLoadingItemId(column.itemId);
      const result = await fetchQuestionAnalysis({
        itemId: column.itemId,
        assessmentId: constraints.assessmentId,
        classGroupId: constraints.classGroupId,
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
    [constraints],
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
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              {node ? <Badge variant="secondary">{nodeTypeLabel(node.nodeType)}</Badge> : null}
              {codeLabel ? <Badge variant="outline">{codeLabel}</Badge> : null}
            </div>
            <DialogTitle className="text-base leading-snug">
              {node ? node.nodeName : 'Desglose del logro'}
            </DialogTitle>
            <DialogDescription>
              {currentLevel === 'question'
                ? 'Preguntas asociadas a este logro. Toca una para ver su distribución de respuestas y análisis de distractores.'
                : LEVEL_PROMPT[currentLevel]}
            </DialogDescription>
          </DialogHeader>

          {/* Breadcrumb de la escalera (permite volver a cualquier nivel). */}
          {path.length > 0 ? (
            <nav
              className="flex flex-wrap items-center gap-1 text-xs"
              aria-label="Ruta del desglose"
            >
              <button
                type="button"
                onClick={() => setPath([])}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <Home className="size-3" aria-hidden />
                Inicio
              </button>
              {path.map((step, i) => (
                <span key={`${step.level}-${step.id}`} className="flex items-center gap-1">
                  <ChevronRight className="size-3 text-muted-foreground" aria-hidden />
                  <button
                    type="button"
                    onClick={() => setPath((p) => p.slice(0, i + 1))}
                    className={cn(
                      'rounded px-1.5 py-0.5 transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring',
                      i === path.length - 1
                        ? 'font-medium text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {step.label}
                  </button>
                </span>
              ))}
            </nav>
          ) : null}

          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
              <Loader2 className="size-6 animate-spin" aria-hidden />
              <p className="text-sm">Cargando desglose…</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
              <Inbox className="size-6" aria-hidden />
              <p>{error}</p>
            </div>
          ) : currentLevel === 'question' ? (
            questions && questions.length > 0 ? (
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
              <EmptyBreakdown message="No se encontraron preguntas asociadas a este logro en la evaluación." />
            )
          ) : rows && rows.length > 0 ? (
            <ul className="space-y-2">
              {rows.map((row) => (
                <li key={row.id}>
                  <BreakdownRowButton row={row} onSelect={() => selectRow(row)} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyBreakdown message="No hay resultados para este logro con los filtros aplicados." />
          )}
        </DialogContent>
      </Dialog>

      <QuestionDetailPanel data={detail} open={detailOpen} onClose={closeDetail} />
    </>
  );
}

function EmptyBreakdown({ message }: { message: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">
      <Inbox className="size-6" aria-hidden />
      <p>{message}</p>
    </div>
  );
}

function BreakdownRowButton({
  row,
  onSelect,
}: {
  row: SkillBreakdownRow;
  onSelect: () => void;
}): JSX.Element {
  const pct = row.averageAchievement ?? 0;
  const barClass = row.performanceLevel
    ? PERFORMANCE_LEVEL_BAR_CLASS[row.performanceLevel]
    : 'bg-muted-foreground/40';

  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full space-y-2 rounded-md border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
      aria-label={`Desglosar ${row.label}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-sm font-medium leading-tight">
            {row.label}
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </p>
          <p className="text-xs text-muted-foreground">
            {[row.sublabel, `${row.studentsAssessed} alumnos`].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tabular-nums">
            {formatAchievement(row.averageAchievement)}
          </span>
          <PerformanceBadge level={row.performanceLevel} />
        </div>
      </div>

      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Logro de ${row.label}`}
      >
        <div
          className={cn('h-full rounded-full transition-[width] motion-reduce:transition-none', barClass)}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </button>
  );
}
