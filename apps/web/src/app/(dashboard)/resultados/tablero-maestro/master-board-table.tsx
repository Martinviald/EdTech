'use client';

import { Fragment, useMemo, useState, type JSX, type ReactNode } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { ChevronDown, ChevronRight, Info, Layers } from 'lucide-react';
import type {
  CellSample,
  MasterBoardCell,
  MasterBoardCourseCell,
  MasterBoardMatrix,
  MasterBoardSubject,
  MasterBoardTest,
  MetricKey,
  MetricTone,
  MetricValue,
  PerformanceLevel,
} from '@soe/types';
import { ALERT_THRESHOLDS } from '@soe/types';
import { SampleComparisonLines, type ComparisonLine } from '@/components/shared/sample-contrast';
import { useTelemetry } from '@/lib/telemetry';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ROUTES } from '@/lib/routes';
import { cn } from '@/lib/utils';

const LEVEL_ORDER: readonly PerformanceLevel[] = [
  'insufficient',
  'elementary',
  'adequate',
  'advanced',
];

const LEVEL_CELL_CLASS: Record<PerformanceLevel, string> = {
  insufficient: 'bg-level-insufficient/15 text-level-insufficient',
  elementary: 'bg-level-elementary/15 text-level-elementary',
  adequate: 'bg-level-adequate/15 text-level-adequate',
  advanced: 'bg-level-advanced/15 text-level-advanced',
};

const NO_DATA_CELL_CLASS = 'bg-muted/40 text-muted-foreground';
const UNLEVELED_CELL_CLASS = 'bg-muted text-foreground';

const TONE_ORDER: readonly MetricTone[] = ['below', 'similar', 'above'];

const TONE_CELL_CLASS: Record<MetricTone, string> = {
  below: 'bg-destructive/10 text-destructive',
  similar: 'bg-muted text-foreground',
  above: 'bg-success/10 text-success',
};

const TONE_LABEL: Record<MetricTone, string> = {
  below: 'Bajo la muestra',
  similar: `Similar a la muestra (±${ALERT_THRESHOLDS.cohort.similarPp} pp)`,
  above: 'Sobre la muestra',
};

const SAMPLE_SURFACE = 'master_board';

const SECTION_WITHOUT_LEVELS = 'Sección de la prueba: sin cortes de nivel propios';
const INSTRUMENT_WITHOUT_LEVELS = 'Instrumento sin cortes de nivel propios';
const MIXED_CELL = 'Mezcla instrumentos distintos: no se colorea por nivel';

type CellLike = Pick<MasterBoardCell, 'metrics' | 'mixed' | 'hasLevels'>;

/**
 * Cómo se pinta una celda: por banda, en escala neutra, como mixta o sin datos; con la métrica
 * de diferencia contra la muestra, por su tono (bajo / similar / sobre).
 */
export type CellKind = 'level' | 'unleveled' | 'mixed' | 'empty' | 'tone';

type CellAppearance = {
  kind: CellKind;
  metric: MetricValue | undefined;
  className: string;
};

function primaryMetric(metrics: MetricValue[], key: MetricKey): MetricValue | undefined {
  return metrics.find((metric) => metric.key === key);
}

export function cellAppearance(cell: CellLike | undefined, metricKey: MetricKey): CellAppearance {
  const metric = cell ? primaryMetric(cell.metrics, metricKey) : undefined;
  if (!cell || !metric || metric.value === null) {
    return { kind: 'empty', metric, className: NO_DATA_CELL_CLASS };
  }
  if (metric.tone) return { kind: 'tone', metric, className: TONE_CELL_CLASS[metric.tone] };
  if (cell.mixed) return { kind: 'mixed', metric, className: UNLEVELED_CELL_CLASS };
  const levelClass = metric.level ? LEVEL_CELL_CLASS[metric.level.color] : undefined;
  if (cell.hasLevels && levelClass) return { kind: 'level', metric, className: levelClass };
  return { kind: 'unleveled', metric, className: UNLEVELED_CELL_CLASS };
}

function unleveledReason(test: MasterBoardTest): string {
  return test.source === 'section' ? SECTION_WITHOUT_LEVELS : INSTRUMENT_WITHOUT_LEVELS;
}

function indexByTestKey<T extends { testKey: string }>(cells: T[]): Map<string, T> {
  return new Map(cells.map((cell) => [cell.testKey, cell]));
}

function courseCellHref(cell: MasterBoardCourseCell, classGroupId: string): Route | null {
  if (cell.assessmentIds.length === 1) {
    return `${ROUTES.evaluacionDetalle(cell.assessmentIds[0]!)}?classGroupId=${classGroupId}` as Route;
  }
  if (cell.assessmentIds.length > 1) {
    return `${ROUTES.evaluaciones}?classGroupId=${classGroupId}&subjectId=${cell.subjectId}` as Route;
  }
  return null;
}

function studentsLabel(count: number): string {
  if (count === 0) return 'Sin alumnos evaluados';
  return `${count} ${count === 1 ? 'alumno evaluado' : 'alumnos evaluados'}`;
}

type Column = { subject: MasterBoardSubject; test: MasterBoardTest };

/** Primer motivo de no comparabilidad de cada prueba, mirando sus celdas de nivel y de curso. */
export function comparabilityNoticesByTest(data: MasterBoardMatrix): Map<string, string> {
  const notices = new Map<string, string>();
  const collect = (cell: Pick<MasterBoardCell, 'testKey' | 'comparability'>) => {
    if (notices.has(cell.testKey)) return;
    const { aggregatable, reason } = cell.comparability;
    if (!aggregatable && reason) notices.set(cell.testKey, reason);
  };
  for (const grade of data.grades) {
    grade.cells.forEach(collect);
    for (const course of grade.courses) course.cells.forEach(collect);
  }
  return notices;
}

export function MasterBoardTable({
  data,
  canViewTeacher,
}: {
  data: MasterBoardMatrix;
  canViewTeacher: boolean;
}) {
  const { subjects, grades, primaryMetricKey } = data;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const columns = useMemo<Column[]>(
    () => subjects.flatMap((subject) => subject.tests.map((test) => ({ subject, test }))),
    [subjects],
  );
  const hasTestRow = useMemo(
    () => subjects.some((subject) => subject.tests.length > 1),
    [subjects],
  );
  const notices = useMemo(() => comparabilityNoticesByTest(data), [data]);
  const gradeCells = useMemo(
    () => new Map(grades.map((grade) => [grade.gradeId, indexByTestKey(grade.cells)])),
    [grades],
  );

  const toggle = (gradeId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(gradeId)) next.delete(gradeId);
      else next.add(gradeId);
      return next;
    });
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="w-full overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead
                rowSpan={hasTestRow ? 2 : undefined}
                className="sticky left-0 z-20 min-w-[140px] bg-card sm:min-w-[200px]"
              >
                Nivel / Curso
              </TableHead>
              {subjects.map((subject) => {
                const label = subject.shortName || subject.name;
                const onlyTest = subject.tests.length === 1 ? subject.tests[0] : undefined;
                if (onlyTest) {
                  return (
                    <TestHead
                      key={subject.subjectId}
                      label={label}
                      fullName={onlyTest.source === 'subject' ? subject.name : onlyTest.name}
                      notice={notices.get(onlyTest.testKey)}
                      rowSpan={hasTestRow ? 2 : undefined}
                    />
                  );
                }
                return (
                  <TableHead
                    key={subject.subjectId}
                    colSpan={subject.tests.length}
                    title={subject.name}
                    className="border-l text-center"
                  >
                    {label}
                  </TableHead>
                );
              })}
            </TableRow>
            {hasTestRow ? (
              <TableRow>
                {subjects
                  .filter((subject) => subject.tests.length > 1)
                  .flatMap((subject) =>
                    subject.tests.map((test, index) => (
                      <TestHead
                        key={test.testKey}
                        label={test.shortName || test.name}
                        fullName={test.name}
                        notice={notices.get(test.testKey)}
                        className={cn('h-9 text-xs', index === 0 && 'border-l')}
                      />
                    )),
                  )}
              </TableRow>
            ) : null}
          </TableHeader>
          <TableBody>
            {grades.map((grade) => {
              const isOpen = expanded.has(grade.gradeId);
              const cells = gradeCells.get(grade.gradeId);
              return (
                <Fragment key={grade.gradeId}>
                  <TableRow className="bg-muted/30">
                    <TableCell className="sticky left-0 z-10 bg-card">
                      <button
                        type="button"
                        onClick={() => toggle(grade.gradeId)}
                        aria-expanded={isOpen}
                        aria-label={isOpen ? `Contraer ${grade.name}` : `Expandir ${grade.name}`}
                        className="flex items-center gap-1.5 font-semibold text-foreground hover:text-primary"
                      >
                        {isOpen ? (
                          <ChevronDown className="size-4 shrink-0" aria-hidden />
                        ) : (
                          <ChevronRight className="size-4 shrink-0" aria-hidden />
                        )}
                        {grade.name}
                      </button>
                    </TableCell>
                    {columns.map(({ test }) => (
                      <GradeCell
                        key={test.testKey}
                        cell={cells?.get(test.testKey)}
                        test={test}
                        metricKey={primaryMetricKey}
                      />
                    ))}
                  </TableRow>

                  {isOpen
                    ? grade.courses.map((course) => {
                        const courseCells = indexByTestKey(course.cells);
                        return (
                          <TableRow key={course.classGroupId}>
                            <TableCell className="sticky left-0 z-10 bg-card">
                              <span className="block pl-6 text-sm text-muted-foreground">
                                {course.name}
                              </span>
                            </TableCell>
                            {columns.map(({ test }) => (
                              <CourseCell
                                key={test.testKey}
                                cell={courseCells.get(test.testKey)}
                                gradeCell={cells?.get(test.testKey)}
                                test={test}
                                classGroupId={course.classGroupId}
                                metricKey={primaryMetricKey}
                                canViewTeacher={canViewTeacher}
                              />
                            ))}
                          </TableRow>
                        );
                      })
                    : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  );
}

function TestHead({
  label,
  fullName,
  notice,
  rowSpan,
  className,
}: {
  label: string;
  fullName: string;
  notice: string | undefined;
  rowSpan?: number;
  className?: string;
}) {
  const head = (
    <TableHead
      rowSpan={rowSpan}
      className={cn('min-w-[96px] text-center', className)}
      data-comparability-notice={notice ? 'true' : undefined}
    >
      <span className="inline-flex items-center justify-center gap-1">
        {label}
        {notice ? (
          <>
            <Info className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="sr-only">(resultados no comparables)</span>
          </>
        ) : null}
      </span>
    </TableHead>
  );
  if (!notice && fullName === label) return head;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{head}</TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {fullName !== label ? <p className="text-xs font-medium">{fullName}</p> : null}
        {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
      </TooltipContent>
    </Tooltip>
  );
}

function CellNotes({
  kind,
  test,
  metrics,
  studentsAssessed,
}: {
  kind: CellKind;
  test: MasterBoardTest;
  metrics: MetricValue[];
  studentsAssessed: number;
}) {
  return (
    <>
      {metrics.map((metric) => (
        <p key={metric.key} className="text-xs">
          <span className="text-muted-foreground">{metric.label}:</span>{' '}
          <span className="font-medium">{metric.display}</span>
          {kind === 'level' && metric.level ? ` · Nivel del promedio: ${metric.level.label}` : ''}
        </p>
      ))}
      {kind === 'unleveled' ? (
        <p className="text-xs text-muted-foreground">{unleveledReason(test)}</p>
      ) : null}
      {kind === 'mixed' ? <p className="text-xs text-muted-foreground">{MIXED_CELL}</p> : null}
      <p className="text-xs text-muted-foreground">{studentsLabel(studentsAssessed)}</p>
    </>
  );
}

function CellValue({ display, kind }: { display: string; kind: CellKind }) {
  return (
    <span className="inline-flex items-center justify-center gap-1">
      {display}
      {kind === 'mixed' ? (
        <>
          <Layers className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">(mixta)</span>
        </>
      ) : null}
    </span>
  );
}

function EmptyCell() {
  return (
    <TableCell
      className={cn('text-center text-sm tabular-nums', NO_DATA_CELL_CLASS)}
      data-cell-kind="empty"
    >
      —
    </TableCell>
  );
}

function useSampleTracking(sample: CellSample | null) {
  const { track } = useTelemetry();
  return (open: boolean) => {
    if (open && sample) {
      track('benchmark.sample_viewed', {
        surface: SAMPLE_SURFACE,
        instrumentId: sample.instrumentId,
      });
    }
  };
}

function CellSampleNotes({ sample, lines }: { sample: CellSample; lines: ComparisonLine[] }) {
  return (
    <div className="mt-2 space-y-1 border-t pt-2">
      <p className="text-xs font-semibold">Contra la {sample.label.toLowerCase()}</p>
      <SampleComparisonLines
        lines={lines}
        sample={sample}
        instrumentId={sample.instrumentId}
        surface={SAMPLE_SURFACE}
      />
    </div>
  );
}

function GradeCell({
  cell,
  test,
  metricKey,
}: {
  cell: MasterBoardCell | undefined;
  test: MasterBoardTest;
  metricKey: MetricKey;
}) {
  const onOpenChange = useSampleTracking(cell?.sample ?? null);
  if (!cell) return <EmptyCell />;
  const { kind, metric, className } = cellAppearance(cell, metricKey);
  return (
    <Tooltip onOpenChange={onOpenChange}>
      <TooltipTrigger asChild>
        <TableCell
          className={cn('text-center text-sm font-bold tabular-nums', className)}
          data-cell-kind={kind}
        >
          <CellValue display={metric?.display ?? '—'} kind={kind} />
        </TableCell>
      </TooltipTrigger>
      <TooltipContent>
        <CellNotes
          kind={kind}
          test={test}
          metrics={cell.metrics}
          studentsAssessed={cell.studentsAssessed}
        />
        {cell.sample ? (
          <CellSampleNotes
            sample={cell.sample}
            lines={[{ label: 'Nivel', value: cell.sample.cellValue }]}
          />
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

function CourseCell({
  cell,
  gradeCell,
  test,
  classGroupId,
  metricKey,
  canViewTeacher,
}: {
  cell: MasterBoardCourseCell | undefined;
  gradeCell: MasterBoardCell | undefined;
  test: MasterBoardTest;
  classGroupId: string;
  metricKey: MetricKey;
  canViewTeacher: boolean;
}) {
  const onOpenChange = useSampleTracking(cell?.sample ?? null);
  if (!cell) return <EmptyCell />;
  const { kind, metric, className } = cellAppearance(cell, metricKey);
  const href = courseCellHref(cell, classGroupId);
  const gradeAchievement = gradeCell
    ? (primaryMetric(gradeCell.metrics, 'achievement')?.value ?? null)
    : null;
  const value = <CellValue display={metric?.display ?? '—'} kind={kind} />;

  return (
    <Tooltip onOpenChange={onOpenChange}>
      <TooltipTrigger asChild>
        <TableCell
          className={cn(
            'text-center text-sm font-semibold tabular-nums',
            className,
            href && 'transition-opacity hover:opacity-80',
          )}
          data-cell-kind={kind}
        >
          {href ? (
            <Link href={href} className="block">
              {value}
            </Link>
          ) : (
            value
          )}
        </TableCell>
      </TooltipTrigger>
      <TooltipContent>
        <CellNotes
          kind={kind}
          test={test}
          metrics={cell.metrics}
          studentsAssessed={cell.studentsAssessed}
        />
        {cell.teacher ? (
          <p className="mt-1 text-xs">
            <span className="text-muted-foreground">Profesor(a): </span>
            {canViewTeacher ? (
              <Link
                href={ROUTES.equipoMiembro(cell.teacher.userId)}
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                {cell.teacher.name}
              </Link>
            ) : (
              <span className="font-medium">{cell.teacher.name}</span>
            )}
          </p>
        ) : null}
        {cell.sample ? (
          <CellSampleNotes
            sample={cell.sample}
            lines={[
              { label: 'Curso', value: cell.sample.cellValue },
              {
                label: 'Nivel',
                value: gradeCell?.sample?.cellValue ?? gradeAchievement,
                withDelta: false,
              },
            ]}
          />
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

export type LegendEntry = { key: string; label: string; swatchClass: string; icon?: ReactNode };

/**
 * Leyenda con lo que efectivamente aparece en la matriz: las bandas presentes (agrupadas por
 * su color, con sus etiquetas) y, si corresponde, celdas sin niveles, mixtas o sin datos.
 */
export function collectLegendEntries(data: MasterBoardMatrix): LegendEntry[] {
  const labelsByColor = new Map<PerformanceLevel, Set<string>>();
  const kinds = new Set<CellKind>();
  const tones = new Set<MetricTone>();
  const visit = (cell: CellLike) => {
    const { kind, metric } = cellAppearance(cell, data.primaryMetricKey);
    kinds.add(kind);
    if (kind === 'tone' && metric?.tone) tones.add(metric.tone);
    if (kind !== 'level' || !metric?.level) return;
    let labels = labelsByColor.get(metric.level.color);
    if (!labels) {
      labels = new Set();
      labelsByColor.set(metric.level.color, labels);
    }
    labels.add(metric.level.label);
  };
  const columnCount = data.subjects.reduce((total, subject) => total + subject.tests.length, 0);
  for (const grade of data.grades) {
    grade.cells.forEach(visit);
    if (grade.cells.length < columnCount) kinds.add('empty');
    for (const course of grade.courses) course.cells.forEach(visit);
  }

  const entries: LegendEntry[] = [];
  if (data.primaryMetricKey === 'sample_delta') {
    for (const tone of TONE_ORDER) {
      if (!tones.has(tone)) continue;
      entries.push({ key: tone, label: TONE_LABEL[tone], swatchClass: TONE_CELL_CLASS[tone] });
    }
    if (kinds.has('empty')) {
      entries.push({ key: 'empty', label: 'Sin muestra', swatchClass: NO_DATA_CELL_CLASS });
    }
    return entries;
  }
  for (const color of LEVEL_ORDER) {
    const labels = labelsByColor.get(color);
    if (!labels) continue;
    entries.push({
      key: color,
      label: [...labels].join(' / '),
      swatchClass: LEVEL_CELL_CLASS[color],
    });
  }
  if (kinds.has('unleveled')) {
    entries.push({
      key: 'unleveled',
      label: 'Sin cortes de nivel',
      swatchClass: UNLEVELED_CELL_CLASS,
    });
  }
  if (kinds.has('mixed')) {
    entries.push({
      key: 'mixed',
      label: 'Mixta (varios instrumentos)',
      swatchClass: UNLEVELED_CELL_CLASS,
      icon: <Layers className="size-3 text-muted-foreground" aria-hidden />,
    });
  }
  if (kinds.has('empty')) {
    entries.push({ key: 'empty', label: 'Sin datos', swatchClass: NO_DATA_CELL_CLASS });
  }
  return entries;
}

export function MasterBoardLegend({ data }: { data: MasterBoardMatrix }): JSX.Element | null {
  const entries = useMemo(() => collectLegendEntries(data), [data]);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span className="font-medium">
        {data.primaryMetricKey === 'sample_delta' ? 'Frente a la muestra:' : 'Nivel del promedio:'}
      </span>
      {entries.map((entry) => (
        <span key={entry.key} className="inline-flex items-center gap-1.5" data-legend={entry.key}>
          <span className={cn('inline-block size-3 rounded-sm', entry.swatchClass)} aria-hidden />
          {entry.icon}
          {entry.label}
        </span>
      ))}
    </div>
  );
}
