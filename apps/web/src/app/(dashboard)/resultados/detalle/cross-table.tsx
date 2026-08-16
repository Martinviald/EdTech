'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { responseOutcome, type ResponseOutcome } from '@soe/types';
import type {
  ItemMatrixResponse,
  ItemTaxonomyRef,
  MatrixCell,
  MatrixQuestionColumn,
  MatrixStudentRow,
  QuestionAnalysisResponse,
} from '@soe/types';
import { toast } from 'sonner';
import {
  ArrowDownUp,
  ChevronDown,
  ChevronUp,
  Loader2,
  Maximize2,
  Minimize2,
  RotateCcw,
} from 'lucide-react';
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

/**
 * El nombre del alumno se acota a esta longitud para no ensanchar la columna;
 * lo que exceda el ancho visible se lee con swipe horizontal dentro de la celda.
 */
const MAX_STUDENT_NAME_LENGTH = 30;

function formatPct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return `${value.toFixed(0)}%`;
}

/** Color de cabecera de columna por % de logro (resalta preguntas críticas). */
function correctRateHeaderClass(rate: number | null): string {
  if (rate === null) return 'text-muted-foreground';
  if (rate < 40) return 'text-destructive font-semibold';
  if (rate < 60) return 'text-warning';
  return 'text-success';
}

/**
 * Estado presentable de la celda. El predicado vive en `@soe/types` porque el
 * informe del alumno pintaba el MISMO parcial con otro criterio: una respuesta
 * 3/4 se veía ámbar acá y roja allá.
 */
function outcomeOf(cell: MatrixCell): ResponseOutcome {
  return responseOutcome({
    isCorrect: cell.isCorrect,
    score: cell.score,
    maxScore: cell.maxScore,
    hasAnswer: cell.selectedKey !== null,
  });
}

const CELL_CLASS: Record<ResponseOutcome, string> = {
  correct: 'bg-success/10 text-success',
  partial: 'bg-warning/10 text-warning',
  incorrect: 'bg-destructive/10 text-destructive',
  ungraded: 'bg-muted/40 text-muted-foreground',
  unanswered: 'bg-muted/40 text-muted-foreground',
};

/** Estilo de celda por estado de la respuesta del alumno. */
function cellClass(cell: MatrixCell): string {
  return CELL_CLASS[outcomeOf(cell)];
}

function cellLabel(cell: MatrixCell): string {
  const outcome = outcomeOf(cell);
  if (outcome === 'partial' && cell.score !== null && cell.maxScore !== null) {
    return `${formatScore(cell.score)}/${formatScore(cell.maxScore)}`;
  }
  if (cell.selectedKey) return cell.selectedKey;
  if (outcome === 'ungraded') return '·';
  return '—';
}

const OUTCOME_LABEL: Record<ResponseOutcome, string> = {
  correct: 'correcta',
  partial: 'parcialmente correcta',
  incorrect: 'incorrecta',
  ungraded: 'sin corregir',
  unanswered: 'sin respuesta',
};

function cellTitle(cell: MatrixCell): string {
  const outcome = outcomeOf(cell);
  if (!cell.selectedKey) return outcome === 'ungraded' ? 'Sin corregir' : 'Sin respuesta';
  return `Respondió ${cell.selectedKey} (${OUTCOME_LABEL[outcome]})`;
}

/** 2 → "2", 2.5 → "2,5". Evita el "2.00" de los decimales de la BDD. */
function formatScore(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ',');
}

/**
 * Valor ordenable de una celda: correcta > parcial > incorrecta > en blanco.
 * El parcial se ordena por su crédito, así un 0,9/1 no queda junto a un 0/1.
 */
function cellRank(cell: MatrixCell | undefined): number {
  if (!cell) return -2;
  switch (outcomeOf(cell)) {
    case 'correct':
      return 2 + (cell.score ?? 0);
    case 'partial':
      return 1 + (cell.maxScore ? (cell.score ?? 0) / cell.maxScore : 0);
    case 'incorrect':
      return 0;
    default:
      return -1;
  }
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
  // Modo "pantalla completa": el tablero se muestra como overlay a viewport
  // completo para aprovechar toda la pantalla. Se sale con el botón de minimizar
  // o con Esc (salvo que el panel de detalle esté abierto: ahí Esc lo cierra a él).
  const [maximized, setMaximized] = useState(false);

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

  const { questions, students, references } = matrix;

  // Rótulo de la fila de referencia: sobre cuántos cursos y alumnos del nivel
  // agrega. En un nivel de un solo curso la cifra coincide con la del curso, y sin
  // este detalle eso se lee como un bug en vez de como un hecho de los datos.
  const levelSublabel = describeScope(
    references.grade.gradeName ?? 'Promedio del nivel',
    references.grade.classGroupCount,
    references.grade.studentCount,
  );

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

  // Salir de pantalla completa con Esc + bloquear el scroll del body mientras el
  // overlay está activo. Si el panel de detalle está abierto, Esc lo cierra a él
  // primero (no minimiza), para no perder el tablero al cerrar una pregunta.
  useEffect(() => {
    if (!maximized) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !open) setMaximized(false);
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [maximized, open]);

  const achievementDir = studentSort?.by === 'achievement' ? studentSort.dir : null;
  const sortedColumnId = studentSort?.by === 'column' ? studentSort.itemId : null;
  const anySortActive = studentSort !== null || questionSort !== null;

  return (
    <div
      className={cn(
        'flex flex-col gap-4',
        maximized && 'fixed inset-0 z-50 overflow-hidden bg-background p-4 sm:p-6',
      )}
    >
      <p className="text-xs text-muted-foreground">
        Clic en el <span className="font-medium">número</span> de una pregunta para ver su detalle;
        el botón <ArrowDownUp className="inline size-3" aria-hidden /> bajo cada pregunta ordena a
        los alumnos por esa pregunta. Clic en <span className="font-medium">Logro</span> (cabecera)
        ordena a los alumnos por su logro global; o usa{' '}
        <span className="font-medium">Ordenar preguntas</span>. Verde = correcta, ámbar = parcial,
        rojo = incorrecta, gris = sin respuesta o sin corregir.
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto gap-1.5"
          onClick={() => setMaximized((value) => !value)}
          aria-label={maximized ? 'Minimizar el tablero' : 'Ver el tablero en pantalla completa'}
        >
          {maximized ? (
            <Minimize2 className="size-4" aria-hidden />
          ) : (
            <Maximize2 className="size-4" aria-hidden />
          )}
          {maximized ? 'Minimizar' : 'Pantalla completa'}
        </Button>
      </div>

      <TooltipProvider delayDuration={150}>
        <div
          className={cn(
            'overflow-auto rounded-md border',
            maximized ? 'min-h-0 flex-1' : 'max-h-[70vh]',
          )}
        >
          <Table>
            <TableHeader className="sticky top-0 z-20 bg-background">
              <TableRow>
                <TableHead className="sticky left-0 z-30 w-[150px] bg-background px-2">
                  Alumno
                </TableHead>
                <TableHead className="w-[68px] bg-background px-2 text-right">
                  <button
                    type="button"
                    onClick={sortByAchievement}
                    className="ml-auto inline-flex items-center gap-1 whitespace-nowrap rounded px-1 py-1 font-medium transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
                    aria-label="Ordenar alumnos por porcentaje de logro"
                  >
                    Logro
                    <SortIndicator dir={achievementDir} />
                  </button>
                </TableHead>
                {displayQuestions.map((q) => {
                  const isSorted = sortedColumnId === q.itemId;
                  const isLoading = loadingItemId === q.itemId;
                  return (
                    <TableHead key={q.itemId} className="bg-background px-0.5 text-center">
                      <div className="flex flex-col items-center gap-0.5">
                        {/* Principal: el número de la pregunta abre el detalle. */}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => void openQuestion(q)}
                              disabled={isLoading}
                              className="flex w-full flex-col items-center gap-0.5 rounded px-0.5 py-1 transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-70"
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
              <LevelReferenceRow questions={displayQuestions} sublabel={levelSublabel} />
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

      <QuestionDetailPanel
        data={detail}
        open={open}
        onClose={closePanel}
        canAddToCollection
        assessmentId={assessmentId}
        classGroupId={classGroupId}
      />
    </div>
  );
}

/** Color de texto de la referencia del colegio por % de logro (mismos cortes). */
function referenceCellClass(rate: number | null): string {
  if (rate === null) return 'text-muted-foreground';
  if (rate < 40) return 'text-destructive font-semibold';
  if (rate < 60) return 'text-warning';
  return 'text-success';
}

/** Rótulo de la fila de referencia: "4° Básico · 2 cursos · 87 alumnos". */
function describeScope(name: string, classGroupCount: number, studentCount: number): string {
  if (classGroupCount === 0) return name;
  const cursos = `${classGroupCount} ${classGroupCount === 1 ? 'curso' : 'cursos'}`;
  const alumnos = `${studentCount} ${studentCount === 1 ? 'alumno' : 'alumnos'}`;
  return `${name} · ${cursos} · ${alumnos}`;
}

/**
 * T2-17 — Fila de referencia del tablero maestro: "% de logro del nivel" por
 * pregunta (`q.references.grade`), independiente del scope del usuario. Como los
 * instrumentos son siempre por nivel, es la referencia del colegio para esa
 * evaluación. Cuando exista el pool multi-colegio (TKT-20), la "muestra de
 * colegios" (`q.references.sample`) se agrega como una segunda fila análoga.
 *
 * ⚠️ La columna "% Logro" es el % ponderado sobre TODAS las respuestas de TODOS
 * los alumnos del nivel (`sum(correctCount)/sum(responseCount)` de las columnas
 * visibles), NUNCA el promedio de los % por pregunta ni por curso. El subtítulo
 * dice sobre cuántos cursos y alumnos agrega: sin eso, un nivel de un solo curso
 * se lee como un duplicado de la fila del alumno.
 */
function LevelReferenceRow({
  questions,
  sublabel,
}: {
  questions: MatrixQuestionColumn[];
  sublabel: string;
}): JSX.Element {
  // Agregado ponderado sobre las columnas VISIBLES (respeta el filtro por tags).
  let totalResponses = 0;
  let totalCorrect = 0;
  for (const q of questions) {
    totalResponses += q.references.grade.responseCount;
    totalCorrect += q.references.grade.correctCount;
  }
  const levelOverall = totalResponses > 0 ? (totalCorrect / totalResponses) * 100 : null;

  return (
    <TableRow className="border-b-2 bg-muted/30">
      <TableCell className="sticky left-0 z-10 w-[150px] bg-muted/60 px-2 align-top">
        {/* Mismo ancho fijo que las filas de alumno para que la columna congelada
            no crezca con este texto más largo (que envuelve dentro de los 134px). */}
        <div className="w-[134px]">
          <span className="block text-sm font-semibold">% Logro nivel</span>
          <span className="block text-xs font-normal text-muted-foreground">{sublabel}</span>
        </div>
      </TableCell>
      <TableCell className="w-[68px] px-2 text-right font-semibold tabular-nums">
        {formatPct(levelOverall)}
      </TableCell>
      {questions.map((q) => (
        <TableCell
          key={q.itemId}
          className={cn(
            'px-0.5 py-1.5 text-center text-xs font-semibold tabular-nums',
            referenceCellClass(q.references.grade.rate),
          )}
          title={`Nivel · Pregunta ${q.position}: ${formatPct(q.references.grade.rate)} de logro (${q.references.grade.responseCount} respuestas)`}
        >
          {formatPct(q.references.grade.rate)}
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

  // El nombre se corta a 30 caracteres (con elipsis si excede); el ancho visible
  // es aún menor, y el resto se lee haciendo swipe horizontal dentro de la celda.
  const displayName =
    row.studentFullName.length > MAX_STUDENT_NAME_LENGTH
      ? `${row.studentFullName.slice(0, MAX_STUDENT_NAME_LENGTH)}…`
      : row.studentFullName;

  return (
    <TableRow>
      <TableCell className="sticky left-0 z-10 w-[150px] bg-background px-2 align-top font-medium">
        {/* Ancho FIJO real del wrapper (no un `width` en el `td`, que en
            `table-layout:auto` la columna ignora y crece hasta el nombre completo,
            impidiendo el desborde → sin swipe). Con el ancho fijo, el nombre
            desborda su propio scroll horizontal y se desplaza (swipe) para ver el
            resto; `scrollbar-none` oculta la barra para no ensuciar cada fila. */}
        <div className="w-[134px]">
          {/* Densificado (T2-06): solo el nombre en la fila para ver más alumnos
              por pantalla; RUT, curso y correctas quedan en el tooltip. */}
          <div
            className="overflow-x-auto whitespace-nowrap scrollbar-none"
            title={`${row.studentFullName}${row.studentRut ? ` · ${row.studentRut}` : ''}${
              row.classGroupName ? ` · ${row.classGroupName}` : ''
            } · ${row.correctCount}/${row.answeredCount} correctas`}
          >
            {displayName}
          </div>
        </div>
      </TableCell>
      <TableCell className="w-[68px] px-2 text-right font-medium tabular-nums">
        {row.achievement === null ? '—' : `${row.achievement.toFixed(1)}%`}
      </TableCell>
      {questions.map((q) => {
        const cell = cellByItem.get(q.itemId);
        if (!cell) {
          return (
            <TableCell
              key={q.itemId}
              className="bg-muted/40 px-0.5 py-1.5 text-center text-xs text-muted-foreground"
            >
              ·
            </TableCell>
          );
        }
        return (
          <TableCell
            key={q.itemId}
            className={cn(
              'px-0.5 py-1.5 text-center text-xs font-semibold tabular-nums',
              cellClass(cell),
            )}
            title={cellTitle(cell)}
          >
            {cellLabel(cell)}
          </TableCell>
        );
      })}
    </TableRow>
  );
}
