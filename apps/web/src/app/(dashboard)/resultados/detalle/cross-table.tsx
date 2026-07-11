'use client';

import { useCallback, useMemo, useState } from 'react';
import type { JSX } from 'react';
import type {
  ItemMatrixResponse,
  ItemTaxonomyRef,
  MatrixCell,
  MatrixQuestionColumn,
  MatrixStudentRow,
  QuestionAnalysisResponse,
} from '@soe/types';
import { toast } from 'sonner';
import { ArrowDownUp, ChevronDown, ChevronUp, Loader2, RotateCcw } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { nodeTypeLabel } from '@/lib/taxonomy-labels';
import { QuestionDetailPanel } from '../components/question-detail-panel';
import { TagFilterMenu, type TagFilterOption } from '../components/tag-filter-menu';
import { fetchQuestionAnalysis } from './actions';

// ─────────────────────────────────────────────────────────────────────────────
// H6.11 — Tabla cruzada alumno × pregunta (client). Recibe la matriz ya
// cargada por el Server Component padre (con `all=true`: el curso COMPLETO, sin
// paginar). La interactividad vive aquí:
//   · TKT-09 — ordenamiento EN CLIENTE: alumnos por logro global, preguntas por
//     % de logro, y alumnos por el logro de una pregunta (columna) concreta.
//   · TKT-12 — filtro multi-tag (OR) sobre las columnas, usando los nodos
//     (habilidad/contenido) ya presentes en la matriz.
//   · H6.12 — drill-down a una pregunta (panel de distribución/distractores),
//     cargado bajo demanda vía la Server Action `fetchQuestionAnalysis`.
// ─────────────────────────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc';

/** Orden de alumnos (filas). `null` = orden original del backend (apellido). */
type StudentSort =
  | { by: 'achievement'; dir: SortDir }
  | { by: 'column'; itemId: string; dir: SortDir }
  | null;

/** Orden de preguntas (columnas) por % de logro. `null` = orden original (posición). */
type QuestionSort = { dir: SortDir } | null;

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

/** Valor ordenable de una celda: correcta > incorrecta > en blanco, desempate por score. */
function cellRank(cell: MatrixCell | undefined): number {
  if (!cell) return -2;
  if (cell.isCorrect === true) return 2 + (cell.score ?? 0);
  if (cell.isCorrect === false) return 0;
  return -1; // sin respuesta / sin corrección
}

/** Comparador respetando `null` al final, según dirección. */
function compareNullable(a: number | null, b: number | null, dir: SortDir): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // nulls siempre al final
  if (b === null) return -1;
  return dir === 'asc' ? a - b : b - a;
}

/** Pequeño indicador asc/desc reutilizable. */
function SortIndicator({ dir }: { dir: SortDir | null }): JSX.Element | null {
  if (dir === null) return null;
  return dir === 'asc' ? (
    <ChevronUp className="size-3.5" aria-hidden />
  ) : (
    <ChevronDown className="size-3.5" aria-hidden />
  );
}

export function CrossTable({
  matrix,
  assessmentId,
  classGroupId,
}: {
  matrix: ItemMatrixResponse;
  assessmentId: string;
  classGroupId?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<QuestionAnalysisResponse | null>(null);
  const [loadingItemId, setLoadingItemId] = useState<string | null>(null);

  // TKT-12 — selección de tags (nodeIds) para acotar las columnas (OR).
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  // TKT-09 — estado de ordenamiento (todo en cliente).
  const [studentSort, setStudentSort] = useState<StudentSort>(null);
  const [questionSort, setQuestionSort] = useState<QuestionSort>(null);

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

  // ── TKT-12: opciones de filtro derivadas de los nodos presentes en la matriz ──
  // La matriz sólo expone el nodo representativo de habilidad y de contenido por
  // pregunta; el filtro opera sobre esos nodos (OR). El componente `TagFilterMenu`
  // es el mismo que reutiliza el banco global (TKT-14), alimentándolo allí con el
  // set completo de tags vía `tagIds[]` server-side.
  const tagOptions = useMemo<TagFilterOption[]>(() => {
    const seen = new Set<string>();
    const opts: TagFilterOption[] = [];
    const add = (ref: ItemTaxonomyRef | null): void => {
      if (!ref || seen.has(ref.nodeId)) return;
      seen.add(ref.nodeId);
      opts.push({
        id: ref.nodeId,
        label: ref.nodeName,
        group: nodeTypeLabel(ref.nodeType) ?? undefined,
      });
    };
    for (const q of questions) {
      add(q.skill);
      add(q.content);
    }
    return opts;
  }, [questions]);

  // ── TKT-12: columnas filtradas por tags (OR sobre habilidad ∪ contenido) ──
  const filteredQuestions = useMemo<MatrixQuestionColumn[]>(() => {
    if (selectedTagIds.length === 0) return questions;
    const sel = new Set(selectedTagIds);
    return questions.filter(
      (q) =>
        (q.skill !== null && sel.has(q.skill.nodeId)) ||
        (q.content !== null && sel.has(q.content.nodeId)),
    );
  }, [questions, selectedTagIds]);

  // ── TKT-09: columnas ordenadas por % de logro (si está activo) ──
  const displayQuestions = useMemo<MatrixQuestionColumn[]>(() => {
    if (questionSort === null) return filteredQuestions;
    return [...filteredQuestions].sort((a, b) =>
      compareNullable(a.correctRate, b.correctRate, questionSort.dir),
    );
  }, [filteredQuestions, questionSort]);

  // ── TKT-09: filas ordenadas por logro global o por una columna ──
  const displayStudents = useMemo<MatrixStudentRow[]>(() => {
    if (studentSort === null) return students.data;
    const rows = [...students.data];
    if (studentSort.by === 'achievement') {
      rows.sort((a, b) => compareNullable(a.achievement, b.achievement, studentSort.dir));
      return rows;
    }
    // Orden por el logro de una pregunta concreta (columna).
    const { itemId, dir } = studentSort;
    const rankOf = (row: MatrixStudentRow): number =>
      cellRank(row.cells.find((c) => c.itemId === itemId));
    rows.sort((a, b) => {
      const diff = rankOf(a) - rankOf(b);
      return dir === 'asc' ? diff : -diff;
    });
    return rows;
  }, [students.data, studentSort]);

  const sortByAchievement = useCallback(() => {
    setStudentSort((prev) =>
      prev !== null && prev.by === 'achievement'
        ? { by: 'achievement', dir: prev.dir === 'desc' ? 'asc' : 'desc' }
        : { by: 'achievement', dir: 'desc' },
    );
  }, []);

  const sortByColumn = useCallback((itemId: string) => {
    setStudentSort((prev) =>
      prev !== null && prev.by === 'column' && prev.itemId === itemId
        ? { by: 'column', itemId, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
        : { by: 'column', itemId, dir: 'desc' },
    );
  }, []);

  const toggleQuestionSort = useCallback(() => {
    setQuestionSort((prev) =>
      prev === null ? { dir: 'asc' } : prev.dir === 'asc' ? { dir: 'desc' } : null,
    );
  }, []);

  const resetSort = useCallback(() => {
    setStudentSort(null);
    setQuestionSort(null);
  }, []);

  const achievementDir = studentSort?.by === 'achievement' ? studentSort.dir : null;
  const sortedColumnId = studentSort?.by === 'column' ? studentSort.itemId : null;
  const anySortActive = studentSort !== null || questionSort !== null;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Clic en el <span className="font-medium">número</span> de una pregunta para ver su detalle;
        el botón <ArrowDownUp className="inline size-3" aria-hidden /> bajo cada pregunta ordena a
        los alumnos por esa pregunta. Clic en <span className="font-medium">% Logro colegio</span>{' '}
        (primera columna) ordena a los alumnos por su logro global; o usa{' '}
        <span className="font-medium">Ordenar preguntas</span>. Verde = correcta, rojo = incorrecta,
        gris = sin respuesta.
      </p>

      {/* Barra de herramientas: filtro por tags (TKT-12) + orden de preguntas (TKT-09) */}
      <div className="flex flex-wrap items-center gap-2">
        <TagFilterMenu
          options={tagOptions}
          selected={selectedTagIds}
          onChange={setSelectedTagIds}
          label="Filtrar preguntas"
          emptyLabel="No hay habilidades ni contenidos para filtrar"
        />
        <Button
          type="button"
          variant={questionSort !== null ? 'secondary' : 'outline'}
          size="sm"
          className="gap-1.5"
          onClick={toggleQuestionSort}
        >
          <ArrowDownUp className="size-4" aria-hidden />
          Ordenar preguntas
          <SortIndicator dir={questionSort?.dir ?? null} />
        </Button>
        {anySortActive ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={resetSort}
          >
            <RotateCcw className="size-4" aria-hidden />
            Restablecer orden
          </Button>
        ) : null}
        {selectedTagIds.length > 0 ? (
          <span className="text-xs text-muted-foreground">
            {displayQuestions.length} de {questions.length} preguntas
          </span>
        ) : null}
      </div>

      <TooltipProvider delayDuration={150}>
        <div className="max-h-[70vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader className="sticky top-0 z-20 bg-background">
              <TableRow>
                <TableHead className="sticky left-0 z-30 min-w-[180px] bg-background">
                  Alumno
                </TableHead>
                {/* El orden por logro global se dispara desde la primera celda de la
                    fila "% Logro colegio" (ver SchoolReferenceRow); aquí solo el rótulo. */}
                <TableHead className="bg-background text-right font-medium">% Logro</TableHead>
                {displayQuestions.map((q) => {
                  const isSorted = sortedColumnId === q.itemId;
                  const isLoading = loadingItemId === q.itemId;
                  return (
                    <TableHead key={q.itemId} className="bg-background px-1 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        {/* Principal: el número de la pregunta abre el detalle. */}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => void openQuestion(q)}
                              disabled={isLoading}
                              className="flex w-full flex-col items-center gap-0.5 rounded px-1.5 py-1 transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-70"
                              aria-label={`Ver el detalle de la pregunta ${q.position}`}
                            >
                              <span className="inline-flex items-center gap-0.5 text-sm font-medium tabular-nums">
                                P{q.position}
                                {isLoading ? (
                                  <Loader2 className="size-3 animate-spin" aria-hidden />
                                ) : null}
                              </span>
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
                            <p className="mt-1 text-muted-foreground">
                              Clic para ver el detalle de la pregunta.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                        {/* Secundario: botón chico para ordenar alumnos por esta pregunta. */}
                        <button
                          type="button"
                          onClick={() => sortByColumn(q.itemId)}
                          className={cn(
                            'inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring',
                            isSorted && 'bg-accent text-foreground',
                          )}
                          aria-label={`Ordenar alumnos por el logro de la pregunta ${q.position}`}
                          title="Ordenar alumnos por esta pregunta"
                        >
                          <ArrowDownUp className="size-3" aria-hidden />
                          {isSorted ? <SortIndicator dir={studentSort?.dir ?? null} /> : null}
                        </button>
                      </div>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* TKT-22 — fila de referencia "% de logro del colegio" por pregunta:
                  el promedio de TODA la org, con independencia del scope del
                  usuario (un profesor ve su curso en las celdas de alumnos y el
                  colegio completo aquí). La línea de "muestra de colegios"
                  (benchmark inter-colegio) queda DIFERIDA hasta existir un pool
                  multi-colegio; llegará como `q.references.sample` sin romper esto. */}
              <SchoolReferenceRow
                questions={displayQuestions}
                onSortAchievement={sortByAchievement}
                achievementDir={achievementDir}
              />
              {displayStudents.map((row) => (
                <StudentRow key={row.studentId} row={row} questions={displayQuestions} />
              ))}
            </TableBody>
          </Table>
        </div>
      </TooltipProvider>

      <p className="text-xs text-muted-foreground">
        {students.total} {students.total === 1 ? 'alumno' : 'alumnos'} · {displayQuestions.length}{' '}
        {displayQuestions.length === 1 ? 'pregunta' : 'preguntas'}
      </p>

      <QuestionDetailPanel data={detail} open={open} onClose={closePanel} />
    </div>
  );
}

/** Color de texto de la referencia del colegio por % de logro (mismos cortes). */
function referenceCellClass(rate: number | null): string {
  if (rate === null) return 'text-muted-foreground';
  if (rate < 40) return 'text-red-700 dark:text-red-300 font-semibold';
  if (rate < 60) return 'text-amber-700 dark:text-amber-300';
  return 'text-emerald-700 dark:text-emerald-300';
}

/**
 * TKT-22 — Fila de referencia del tablero maestro: "% de logro del colegio" por
 * pregunta (`q.references.org`), independiente del scope del usuario. La columna
 * "% Logro" muestra el promedio de esas tasas como referencia agregada. Cuando
 * exista el pool multi-colegio (TKT-20), la "muestra de colegios"
 * (`q.references.sample`) se agrega como una segunda fila análoga.
 */
function SchoolReferenceRow({
  questions,
  onSortAchievement,
  achievementDir,
}: {
  questions: MatrixQuestionColumn[];
  onSortAchievement: () => void;
  achievementDir: SortDir | null;
}): JSX.Element {
  const orgRates = questions.map((q) => q.references.org).filter((v): v is number => v !== null);
  const orgMean =
    orgRates.length > 0 ? orgRates.reduce((a, b) => a + b, 0) / orgRates.length : null;

  return (
    <TableRow className="border-b-2 bg-muted/30">
      {/* Primera columna: clic ordena a los alumnos por su % de logro global. */}
      <TableCell className="sticky left-0 z-10 bg-muted/60 p-0 align-top">
        <button
          type="button"
          onClick={onSortAchievement}
          className={cn(
            'flex w-full flex-col items-start gap-0 px-4 py-2 text-left transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-inset focus:ring-ring',
            achievementDir !== null && 'bg-accent/60',
          )}
          aria-label="Ordenar alumnos por su porcentaje de logro global"
          title="Clic para ordenar alumnos por su % de logro global"
        >
          <span className="inline-flex items-center gap-1 text-sm font-semibold">
            % Logro colegio
            <SortIndicator dir={achievementDir} />
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            Promedio de la organización · clic para ordenar alumnos
          </span>
        </button>
      </TableCell>
      <TableCell className="text-right font-semibold tabular-nums">{formatPct(orgMean)}</TableCell>
      {questions.map((q) => (
        <TableCell
          key={q.itemId}
          className={cn(
            'text-center text-xs font-semibold tabular-nums',
            referenceCellClass(q.references.org),
          )}
          title={`Colegio · Pregunta ${q.position}: ${formatPct(q.references.org)} de logro`}
        >
          {formatPct(q.references.org)}
        </TableCell>
      ))}
    </TableRow>
  );
}

function StudentRow({
  row,
  questions,
}: {
  row: MatrixStudentRow;
  questions: MatrixQuestionColumn[];
}): JSX.Element {
  // Mapa itemId → celda para emparejar columnas aunque el orden no coincida.
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
