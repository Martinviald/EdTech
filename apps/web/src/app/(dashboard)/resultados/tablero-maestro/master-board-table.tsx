'use client';

import { Fragment, useState, type JSX } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type {
  MasterBoardCell,
  MasterBoardCourseCell,
  MasterBoardMatrix,
  MetricKey,
  MetricValue,
  PerformanceLevel,
} from '@soe/types';
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
import { PERFORMANCE_LEVEL_LABELS } from '../components/performance-level';

const LEVEL_CELL_CLASS: Record<PerformanceLevel, string> = {
  insufficient: 'bg-level-insufficient/15 text-level-insufficient',
  elementary: 'bg-level-elementary/15 text-level-elementary',
  adequate: 'bg-level-adequate/15 text-level-adequate',
  advanced: 'bg-level-advanced/15 text-level-advanced',
};

const NO_DATA_CELL_CLASS = 'bg-muted/40 text-muted-foreground';

function cellClass(level: PerformanceLevel | null): string {
  return level ? LEVEL_CELL_CLASS[level] : NO_DATA_CELL_CLASS;
}

function primaryMetric(metrics: MetricValue[], key: MetricKey): MetricValue | undefined {
  return metrics.find((metric) => metric.key === key);
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

function MetricLines({ metrics }: { metrics: MetricValue[] }) {
  return (
    <>
      {metrics.map((metric) => (
        <p key={metric.key} className="text-xs">
          <span className="text-muted-foreground">{metric.label}:</span>{' '}
          <span className="font-medium">{metric.display}</span>
          {metric.level ? ` · ${PERFORMANCE_LEVEL_LABELS[metric.level]}` : ''}
        </p>
      ))}
    </>
  );
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
              <TableHead className="sticky left-0 z-10 min-w-[200px] bg-card">
                Nivel / Curso
              </TableHead>
              {subjects.map((subject) => (
                <TableHead key={subject.subjectId} className="min-w-[96px] text-center">
                  {subject.shortName || subject.name}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {grades.map((grade) => {
              const isOpen = expanded.has(grade.gradeId);
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
                    {grade.cells.map((cell) => (
                      <GradeCell key={cell.subjectId} cell={cell} metricKey={primaryMetricKey} />
                    ))}
                  </TableRow>

                  {isOpen
                    ? grade.courses.map((course) => (
                        <TableRow key={course.classGroupId}>
                          <TableCell className="sticky left-0 z-10 bg-card">
                            <span className="block pl-6 text-sm text-muted-foreground">
                              {course.name}
                            </span>
                          </TableCell>
                          {course.cells.map((cell) => (
                            <CourseCell
                              key={cell.subjectId}
                              cell={cell}
                              classGroupId={course.classGroupId}
                              metricKey={primaryMetricKey}
                              canViewTeacher={canViewTeacher}
                            />
                          ))}
                        </TableRow>
                      ))
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

function GradeCell({ cell, metricKey }: { cell: MasterBoardCell; metricKey: MetricKey }) {
  const metric = primaryMetric(cell.metrics, metricKey);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <TableCell
          className={cn(
            'text-center text-sm font-bold tabular-nums',
            cellClass(metric?.level ?? null),
          )}
        >
          {metric?.display ?? '—'}
        </TableCell>
      </TooltipTrigger>
      <TooltipContent>
        <MetricLines metrics={cell.metrics} />
        <p className="text-xs text-muted-foreground">{studentsLabel(cell.studentsAssessed)}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function CourseCell({
  cell,
  classGroupId,
  metricKey,
  canViewTeacher,
}: {
  cell: MasterBoardCourseCell;
  classGroupId: string;
  metricKey: MetricKey;
  canViewTeacher: boolean;
}) {
  const metric = primaryMetric(cell.metrics, metricKey);
  const href = courseCellHref(cell, classGroupId);
  const display = metric?.display ?? '—';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <TableCell
          className={cn(
            'text-center text-sm font-semibold tabular-nums',
            cellClass(metric?.level ?? null),
            href && 'transition-opacity hover:opacity-80',
          )}
        >
          {href ? (
            <Link href={href} className="block">
              {display}
            </Link>
          ) : (
            display
          )}
        </TableCell>
      </TooltipTrigger>
      <TooltipContent>
        <MetricLines metrics={cell.metrics} />
        <p className="text-xs text-muted-foreground">{studentsLabel(cell.studentsAssessed)}</p>
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
      </TooltipContent>
    </Tooltip>
  );
}

export function MasterBoardLegend(): JSX.Element {
  const levels: PerformanceLevel[] = ['insufficient', 'elementary', 'adequate', 'advanced'];
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span className="font-medium">Escala de logro:</span>
      {levels.map((level) => (
        <span key={level} className="inline-flex items-center gap-1.5">
          <span
            className={cn('inline-block size-3 rounded-sm', LEVEL_CELL_CLASS[level])}
            aria-hidden
          />
          {PERFORMANCE_LEVEL_LABELS[level]}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className={cn('inline-block size-3 rounded-sm', NO_DATA_CELL_CLASS)} aria-hidden />
        Sin datos
      </span>
    </div>
  );
}
