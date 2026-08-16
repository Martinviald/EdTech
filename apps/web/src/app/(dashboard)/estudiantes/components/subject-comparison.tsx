import { Users, GraduationCap, History } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  type CohortStat,
  type StudentSubjectComparison,
} from '@soe/types';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PerformanceBadge } from '../../resultados/components/performance-badge';
import { formatAchievement } from '../../resultados/components/performance-level';

function anchorMeta(comparison: StudentSubjectComparison): string {
  const { anchor } = comparison;
  const parts = [
    anchor.instrumentName,
    anchor.year !== null ? String(anchor.year) : null,
    anchor.applicationPeriod
      ? INSTRUMENT_APPLICATION_PERIOD_LABELS[anchor.applicationPeriod]
      : null,
  ].filter(Boolean);
  return parts.join('  ·  ');
}

function DeltaChip({ deltaPp }: { deltaPp: number | null }) {
  if (deltaPp === null) {
    return <span className="text-xs text-muted-foreground">sin comparación</span>;
  }
  const rounded = Number(deltaPp.toFixed(1));
  const isAbove = rounded > 0;
  const isBelow = rounded < 0;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
        isAbove && 'bg-level-adequate/15 text-level-adequate',
        isBelow && 'bg-level-insufficient/15 text-level-insufficient',
        !isAbove && !isBelow && 'bg-muted text-muted-foreground',
      )}
    >
      {rounded > 0 ? '+' : ''}
      {rounded} pp
    </span>
  );
}

function ComparisonBar({
  studentAchievement,
  cohortAchievement,
}: {
  studentAchievement: number | null;
  cohortAchievement: number | null;
}) {
  const studentPct =
    studentAchievement !== null ? Math.min(Math.max(studentAchievement, 0), 100) : 0;
  const cohortPct = cohortAchievement !== null ? Math.min(Math.max(cohortAchievement, 0), 100) : 0;
  const isAbove =
    studentAchievement !== null &&
    cohortAchievement !== null &&
    studentAchievement >= cohortAchievement;
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      {cohortAchievement !== null ? (
        <div
          className="absolute inset-y-0 rounded-full bg-border"
          style={{ width: `${cohortPct}%` }}
        />
      ) : null}
      {studentAchievement !== null ? (
        <div
          className={cn(
            'absolute inset-y-0 rounded-full',
            isAbove ? 'bg-level-adequate' : 'bg-level-insufficient',
          )}
          style={{ width: `${studentPct}%` }}
        />
      ) : null}
    </div>
  );
}

function CohortRow({
  icon: Icon,
  title,
  cohort,
  studentAchievement,
}: {
  icon: LucideIcon;
  title: string;
  cohort: CohortStat | null;
  studentAchievement: number | null;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
          <Icon className="size-3.5 text-muted-foreground" aria-hidden />
          {title}
          {cohort ? (
            <span className="text-xs font-normal text-muted-foreground">
              {cohort.label} · {cohort.studentsAssessed}{' '}
              {cohort.studentsAssessed === 1 ? 'alumno' : 'alumnos'}
            </span>
          ) : null}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="text-sm tabular-nums text-muted-foreground">
            {cohort ? formatAchievement(cohort.achievement) : '—'}
          </span>
          <DeltaChip deltaPp={cohort ? cohort.deltaPp : null} />
        </span>
      </div>
      {cohort ? (
        <ComparisonBar
          studentAchievement={studentAchievement}
          cohortAchievement={cohort.achievement}
        />
      ) : (
        <p className="text-xs text-muted-foreground">Sin datos de esta cohorte.</p>
      )}
    </div>
  );
}

function SubjectComparisonCard({ comparison }: { comparison: StudentSubjectComparison }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle className="text-base">{comparison.subjectName ?? 'Sin asignatura'}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{anchorMeta(comparison)}</p>
        </div>
        <PerformanceBadge
          level={comparison.student.performanceLevel}
          band={comparison.student.performanceBand}
        />
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-baseline gap-2">
          <p className="text-2xl font-semibold tabular-nums">
            {formatAchievement(comparison.student.achievement)}
          </p>
          <p className="text-2xs uppercase tracking-wide text-muted-foreground">Logro del alumno</p>
        </div>

        <div className="space-y-3">
          <CohortRow
            icon={Users}
            title="Curso"
            cohort={comparison.course}
            studentAchievement={comparison.student.achievement}
          />
          <CohortRow
            icon={GraduationCap}
            title="Nivel"
            cohort={comparison.grade}
            studentAchievement={comparison.student.achievement}
          />
          {comparison.generations.length > 0 ? (
            <div className="space-y-2">
              <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                <History className="size-3.5 text-muted-foreground" aria-hidden />
                Generaciones anteriores
              </span>
              <div className="space-y-3 border-l border-border pl-3">
                {comparison.generations.map((generation) => (
                  <CohortRow
                    key={generation.label}
                    icon={History}
                    title={generation.label}
                    cohort={generation}
                    studentAchievement={comparison.student.achievement}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function SubjectComparison({
  subjects,
  scope,
}: {
  subjects: StudentSubjectComparison[];
  scope: 'org' | 'teacher';
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">Comparativa por asignatura</h2>
        <p className="text-xs text-muted-foreground">
          {scope === 'teacher'
            ? 'El alumno frente a su curso, su nivel y las generaciones anteriores, acotado a los cursos que tienes asignados.'
            : 'El alumno frente a su curso, su nivel y las generaciones anteriores.'}
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {subjects.map((comparison) => (
          <SubjectComparisonCard
            key={comparison.subjectId ?? comparison.anchor.instrumentId}
            comparison={comparison}
          />
        ))}
      </div>
    </section>
  );
}
