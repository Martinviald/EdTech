'use client';

import { useCallback, useState } from 'react';
import type { JSX } from 'react';
import type {
  ItemMatrixResponse,
  MatrixCell,
  MatrixQuestionColumn,
  MatrixStudentRow,
  QuestionAnalysisResponse,
} from '@soe/types';
import { toast } from 'sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { PaginationControls } from '../components/pagination-controls';
import { QuestionDetailPanel } from '../components/question-detail-panel';
import { fetchQuestionAnalysis } from './actions';

// ─────────────────────────────────────────────────────────────────────────────
// H6.11 — Tabla cruzada alumno × pregunta (client). Recibe la matriz ya
// cargada por el Server Component padre. La interactividad (hover, drill-down a
// una pregunta) y la carga bajo demanda del panel de distribución (H6.12) viven
// aquí. El fetch de la pregunta se hace vía la Server Action `fetchQuestionAnalysis`.
// ─────────────────────────────────────────────────────────────────────────────

function formatPct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${value.toFixed(0)}%`;
}

/** Color de cabecera de columna por % de logro (resalta preguntas críticas). */
function correctRateHeaderClass(rate: number | null): string {
  if (rate === null) return 'text-muted-foreground';
  if (rate < 40) return 'text-red-700 dark:text-red-300 font-semibold';
  if (rate < 60) return 'text-amber-700 dark:text-amber-300';
  return 'text-emerald-700 dark:text-emerald-300';
}

/** Estilo de celda por estado de la respuesta del alumno. */
function cellClass(cell: MatrixCell): string {
  if (cell.isCorrect === true) {
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200';
  }
  if (cell.isCorrect === false) {
    return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200';
  }
  // Sin respuesta / sin corrección.
  return 'bg-muted/40 text-muted-foreground';
}

function cellLabel(cell: MatrixCell): string {
  if (cell.selectedKey) return cell.selectedKey;
  if (cell.isCorrect === null) return '·';
  return '—';
}

export function CrossTable({
  matrix,
  basePath,
  assessmentId,
  classGroupId,
}: {
  matrix: ItemMatrixResponse;
  basePath: string;
  assessmentId: string;
  classGroupId?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<QuestionAnalysisResponse | null>(null);
  const [loadingItemId, setLoadingItemId] = useState<string | null>(null);

  const openQuestion = useCallback(
    async (column: MatrixQuestionColumn) => {
      setDetail(null);
      setOpen(true);
      setLoadingItemId(column.itemId);
      const result = await fetchQuestionAnalysis({
        itemId: column.itemId,
        assessmentId,
        classGroupId,
      });
      // Evita pisar el estado si el usuario ya cerró/abrió otra pregunta.
      setLoadingItemId((current) => {
        if (current !== column.itemId) return current;
        if (result.ok) {
          setDetail(result.data);
        } else {
          toast.error(result.message);
          setOpen(false);
        }
        return null;
      });
    },
    [assessmentId, classGroupId],
  );

  const closePanel = useCallback(() => {
    setOpen(false);
    setDetail(null);
    setLoadingItemId(null);
  }, []);

  const { questions, students } = matrix;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Toca el número de una pregunta en la cabecera para ver la distribución de respuestas y el
        análisis de distractores. Verde = correcta, rojo = incorrecta, gris = sin respuesta.
      </p>

      <TooltipProvider delayDuration={150}>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-10 min-w-[180px] bg-background">
                  Alumno
                </TableHead>
                <TableHead className="text-right">% Logro</TableHead>
                {questions.map((q) => (
                  <TableHead key={q.itemId} className="px-1 text-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => void openQuestion(q)}
                          className="flex w-full flex-col items-center gap-0.5 rounded px-1.5 py-1 transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
                          aria-label={`Ver detalle de la pregunta ${q.position}`}
                        >
                          <span className="text-sm font-medium tabular-nums">P{q.position}</span>
                          <span
                            className={cn(
                              'text-[10px] tabular-nums',
                              correctRateHeaderClass(q.correctRate),
                            )}
                          >
                            {formatPct(q.correctRate)}
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-xs">
                        <p className="font-medium">Pregunta {q.position}</p>
                        {q.skill ? <p>Habilidad: {q.skill.nodeName}</p> : null}
                        {q.content ? <p>Contenido: {q.content.nodeName}</p> : null}
                        <p>Clave correcta: {q.correctKey ?? '—'}</p>
                        <p>% de logro: {formatPct(q.correctRate)}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.data.map((row) => (
                <StudentRow key={row.studentId} row={row} questions={questions} />
              ))}
            </TableBody>
          </Table>
        </div>
      </TooltipProvider>

      <PaginationControls
        page={students.page}
        limit={students.limit}
        total={students.total}
        basePath={basePath}
      />

      <QuestionDetailPanel data={detail} open={open} onClose={closePanel} />
    </div>
  );
}

function StudentRow({
  row,
  questions,
}: {
  row: MatrixStudentRow;
  questions: MatrixQuestionColumn[];
}): JSX.Element {
  // Mapa itemId → celda para emparejar columnas aunque el orden coincida.
  const cellByItem = new Map<string, MatrixCell>();
  for (const cell of row.cells) cellByItem.set(cell.itemId, cell);

  return (
    <TableRow>
      <TableCell className="sticky left-0 z-10 bg-background font-medium">
        {row.studentFullName}
        <span className="block text-xs font-normal text-muted-foreground">
          {row.studentRut}
          {row.classGroupName ? ` · ${row.classGroupName}` : ''}
        </span>
        <span className="block text-xs font-normal text-muted-foreground">
          {row.correctCount}/{row.answeredCount} correctas
        </span>
      </TableCell>
      <TableCell className="text-right font-medium tabular-nums">
        {row.achievement === null ? '—' : `${row.achievement.toFixed(1)}%`}
      </TableCell>
      {questions.map((q) => {
        const cell = cellByItem.get(q.itemId);
        if (!cell) {
          return (
            <TableCell
              key={q.itemId}
              className="bg-muted/40 text-center text-xs text-muted-foreground"
            >
              ·
            </TableCell>
          );
        }
        return (
          <TableCell
            key={q.itemId}
            className={cn('text-center text-xs font-semibold tabular-nums', cellClass(cell))}
            title={
              cell.selectedKey
                ? `Respondió ${cell.selectedKey}${
                    cell.isCorrect === true
                      ? ' (correcta)'
                      : cell.isCorrect === false
                        ? ' (incorrecta)'
                        : ''
                  }`
                : 'Sin respuesta'
            }
          >
            {cellLabel(cell)}
          </TableCell>
        );
      })}
    </TableRow>
  );
}
