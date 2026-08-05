import {
  AlertTriangle,
  CheckCircle2,
  GraduationCap,
  Lightbulb,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react';
import type { AssessmentReportResponse, SkillAchievementModel } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { DistributionBar } from '../components/distribution-bar';
import { PerformanceBadge } from '../components/performance-badge';
import { StatCard } from '@/components/shared';
import {
  bandLabel,
  formatAchievement,
  PERFORMANCE_LEVEL_BAR_CLASS,
} from '../components/performance-level';
import { ReportExportButton } from './report-export-button';
import { ItemsAnalysisTable } from './items-analysis-table';
import { SkillsBreakdown } from '../components/skills-breakdown';

// ─────────────────────────────────────────────────────────────────────────────
// Cuerpo del informe de evaluación (H6.13). Server Component: sólo presenta los
// datos ya calculados por el backend. Los botones de exportación son los únicos
// fragmentos cliente (ExportButton).
// ─────────────────────────────────────────────────────────────────────────────

const PRIORITY_META: Record<'high' | 'medium' | 'low', { label: string; className: string }> = {
  high: {
    label: 'Alta',
    className: 'bg-destructive/10 text-destructive',
  },
  medium: {
    label: 'Media',
    className: 'bg-warning/15 text-warning',
  },
  low: {
    label: 'Baja',
    className: 'bg-info/10 text-info',
  },
};

function formatDate(value: string | Date | null): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-CL', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function fmtSigned(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}`;
}

export function ReportBody({
  report,
  skillsBreakdown,
  assessmentId,
  classGroupId,
}: {
  report: AssessmentReportResponse;
  // TKT-11/TKT-10: desglose interactivo por dimensión + drill-down a preguntas,
  // cuando hay una evaluación en contexto (hub por-evaluación).
  skillsBreakdown?: SkillAchievementModel[];
  assessmentId?: string;
  classGroupId?: string;
}) {
  const { summary } = report;
  // El DIA es un diagnóstico por niveles de logro (I/II/III), no por notas:
  // ocultamos "Nota promedio" para este tipo de instrumento aunque tenga escala.
  const isDia = report.meta.instrumentType === 'dia';

  // Las tarjetas visibles varían (2 a 4) según escala e instrumento. Ajustamos las
  // columnas para que ocupen todo el ancho y no quede un hueco a la derecha.
  const gradeCards = summary.hasGradingScale ? (isDia ? 1 : 2) : 0;
  const visibleCards = 2 + gradeCards; // % Logro + Asistencia + tarjetas de nota
  const summaryGridCols =
    visibleCards === 2
      ? 'sm:grid-cols-2 lg:grid-cols-2'
      : visibleCards === 3
        ? 'sm:grid-cols-3 lg:grid-cols-3'
        : 'sm:grid-cols-2 lg:grid-cols-4';

  return (
    <div className="space-y-6">
      <FichaTecnica report={report} />

      {/* 1. Síntesis ejecutiva */}
      <section className={`grid grid-cols-1 gap-4 ${summaryGridCols}`}>
        <StatCard
          label="% Logro promedio"
          value={formatAchievement(summary.averageAchievement)}
          hint={`Nivel: ${bandLabel(summary.performanceBand, summary.performanceLevel)}`}
          icon={Target}
        />
        {/* TKT-04: notas/escala solo si el instrumento tiene escala configurada.
            Sin escala, se ocultan estas tarjetas (no se muestra el default 4.0). */}
        {summary.hasGradingScale ? (
          <>
            <StatCard
              label="Aprobación"
              value={summary.passingRate === null ? '—' : `${summary.passingRate.toFixed(1)}%`}
              hint={
                summary.passingGrade === null
                  ? undefined
                  : `Nota de corte: ${summary.passingGrade.toFixed(1)}`
              }
              icon={CheckCircle2}
            />
            {isDia ? null : (
              <StatCard
                label="Nota promedio"
                value={summary.averageGrade === null ? '—' : summary.averageGrade.toFixed(1)}
                hint={summary.averageGrade === null ? undefined : 'Promedio del curso evaluado'}
                icon={GraduationCap}
              />
            )}
          </>
        ) : null}
        <StatCard
          label="Asistencia"
          value={`${summary.studentsEvaluated}/${summary.studentsEnrolled}`}
          hint={
            summary.coverageRate === null
              ? 'Alumnos evaluados'
              : `${summary.coverageRate.toFixed(0)}% de los matriculados`
          }
          icon={Users}
        />
      </section>

      <Highlights report={report} />

      {/* 2. Distribución por nivel */}
      <DistributionBar
        distribution={report.distribution}
        bands={report.bands}
        bandDistribution={report.bandDistribution}
      />

      {/* 3. Comparativa por curso */}
      <CourseComparison report={report} />

      {/* 4. Logro por habilidad (dimensión + drill-down si hay evaluación) */}
      <SkillsSection
        report={report}
        skillsBreakdown={skillsBreakdown}
        assessmentId={assessmentId}
        classGroupId={classGroupId}
      />

      {/* 5. Análisis de preguntas (T2-17: clickeable → panel de detalle) */}
      <ItemsAnalysisTable
        items={report.items}
        assessmentId={assessmentId}
        classGroupId={classGroupId}
      />

      {/* 6. Alumnos en foco */}
      <RiskStudents report={report} />

      {/* 7. Recomendaciones */}
      <Recommendations report={report} />
    </div>
  );
}

// ── Ficha técnica ─────────────────────────────────────────────────────────────

function FichaTecnica({ report }: { report: AssessmentReportResponse }) {
  const { meta } = report;
  const facts: { label: string; value: string }[] = [
    { label: 'Instrumento', value: meta.instrumentName },
    { label: 'Asignatura', value: meta.subjectName ?? '—' },
    { label: 'Nivel', value: meta.gradeName ?? '—' },
    { label: 'Aplicada', value: formatDate(meta.administeredAt) },
    { label: 'Preguntas', value: String(meta.itemsCount) },
    {
      label: 'Cursos',
      value: meta.classGroups.length > 0 ? meta.classGroups.map((c) => c.name).join(', ') : '—',
    },
  ];

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">{meta.assessmentName ?? meta.instrumentName}</h2>
            <p className="text-sm text-muted-foreground">
              Informe consolidado para dirección · {report.summary.studentsEvaluated} alumnos
              evaluados
            </p>
          </div>
          <ReportExportButton report={report} />
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          {facts.map((f) => (
            <div key={f.label} className="space-y-0.5">
              <dt className="text-xs font-medium text-muted-foreground">{f.label}</dt>
              <dd className="text-sm font-medium">{f.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

// ── Highlights (fortalezas / brechas) ─────────────────────────────────────────

function Highlights({ report }: { report: AssessmentReportResponse }) {
  const { strengths, gaps } = report.highlights;
  if (strengths.length === 0 && gaps.length === 0) return null;

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="size-4 text-success" aria-hidden />
            Fortalezas
          </CardTitle>
        </CardHeader>
        <CardContent>
          {strengths.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin datos suficientes.</p>
          ) : (
            <ul className="space-y-1.5">
              {strengths.map((s) => (
                <li key={s} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-success" />
                  {s}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingDown className="size-4 text-destructive" aria-hidden />
            Brechas prioritarias
          </CardTitle>
        </CardHeader>
        <CardContent>
          {gaps.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin datos suficientes.</p>
          ) : (
            <ul className="space-y-1.5">
              {gaps.map((g) => (
                <li key={g} className="flex items-start gap-2 text-sm">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-destructive" />
                  {g}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ── Comparativa por curso ─────────────────────────────────────────────────────

function CourseComparison({ report }: { report: AssessmentReportResponse }) {
  const rows = report.courseComparison;
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Comparativa por curso</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Curso</TableHead>
                <TableHead className="text-right">Evaluados</TableHead>
                <TableHead className="text-right">% Logro</TableHead>
                <TableHead className="text-right">Brecha vs prom.</TableHead>
                <TableHead className="text-right hidden sm:table-cell">% Aprobación</TableHead>
                <TableHead className="text-right">En riesgo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.classGroupId}>
                  <TableCell className="font-medium">{r.classGroupName}</TableCell>
                  <TableCell className="text-right">{r.studentsEvaluated}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatAchievement(r.averageAchievement)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right tabular-nums',
                      r.gapVsAverage !== null && r.gapVsAverage < 0
                        ? 'text-destructive'
                        : r.gapVsAverage !== null && r.gapVsAverage > 0
                          ? 'text-success'
                          : 'text-muted-foreground',
                    )}
                  >
                    {fmtSigned(r.gapVsAverage)}
                  </TableCell>
                  <TableCell className="text-right hidden sm:table-cell">
                    {r.passingRate === null ? '—' : `${r.passingRate.toFixed(1)}%`}
                  </TableCell>
                  <TableCell className="text-right">{r.criticalStudents}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Habilidades ───────────────────────────────────────────────────────────────

function SkillsSection({
  report,
  skillsBreakdown,
  assessmentId,
  classGroupId,
}: {
  report: AssessmentReportResponse;
  skillsBreakdown?: SkillAchievementModel[];
  assessmentId?: string;
  classGroupId?: string;
}) {
  // TKT-11/TKT-10: con una evaluación en contexto se usa el desglose interactivo
  // por dimensión (dropdown habilidad/contenido/OA/eje) con drill-down: clic en un
  // nodo abre el modal de sus preguntas y clic en una pregunta abre su detalle.
  if (skillsBreakdown && skillsBreakdown.length > 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Logro por habilidad</CardTitle>
          <p className="text-sm text-muted-foreground">
            Cambia la dimensión de análisis y haz clic en un nodo para ver sus preguntas.
          </p>
        </CardHeader>
        <CardContent>
          <SkillsBreakdown
            skills={skillsBreakdown}
            filters={{ classGroupId }}
            assessmentId={assessmentId}
          />
        </CardContent>
      </Card>
    );
  }

  const skills = report.skills;
  if (skills.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Logro por habilidad</CardTitle>
        <p className="text-sm text-muted-foreground">
          Ordenado de menor a mayor logro: las primeras son las brechas a reforzar.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {skills.map((s) => {
          const pct = s.averageAchievement ?? 0;
          return (
            <div key={s.nodeId} className="space-y-1">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">
                  {s.nodeName}
                  {s.nodeCode ? (
                    <span className="ml-1 text-xs text-muted-foreground">{s.nodeCode}</span>
                  ) : null}
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums text-muted-foreground">
                    {formatAchievement(s.averageAchievement)}
                  </span>
                  <PerformanceBadge level={s.performanceLevel} band={s.performanceBand} />
                </span>
              </div>
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full',
                    s.performanceLevel
                      ? PERFORMANCE_LEVEL_BAR_CLASS[s.performanceLevel]
                      : 'bg-muted-foreground',
                  )}
                  style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {s.studentsAssessed} alumnos evaluados
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ── Alumnos en foco ───────────────────────────────────────────────────────────

function RiskStudents({ report }: { report: AssessmentReportResponse }) {
  const students = report.studentsAtRisk;
  if (students.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="size-4 text-warning" aria-hidden />
          Alumnos en foco de intervención
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {students.length} alumno(s) en nivel insuficiente o elemental.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Alumno</TableHead>
                <TableHead className="hidden md:table-cell">Curso</TableHead>
                <TableHead className="text-right">% Logro</TableHead>
                <TableHead>Nivel</TableHead>
                <TableHead className="hidden sm:table-cell">Habilidad más débil</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((s) => (
                <TableRow key={s.studentId}>
                  <TableCell className="font-medium">
                    {s.studentFullName}
                    <span className="block text-xs text-muted-foreground">{s.studentRut}</span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{s.classGroupName ?? '—'}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatAchievement(s.achievement)}
                  </TableCell>
                  <TableCell>
                    <PerformanceBadge level={s.performanceLevel} band={s.performanceBand} />
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                    {s.weakestSkill ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Recomendaciones ───────────────────────────────────────────────────────────

function Recommendations({ report }: { report: AssessmentReportResponse }) {
  const recs = report.recommendations;
  if (recs.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb className="size-4 text-info" aria-hidden />
          Recomendaciones
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Próximos pasos sugeridos a partir de los resultados.
        </p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {recs.map((r, idx) => (
            <li key={idx} className="flex items-start gap-3">
              <span
                className={cn(
                  'mt-0.5 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
                  PRIORITY_META[r.priority].className,
                )}
              >
                {PRIORITY_META[r.priority].label}
              </span>
              <span className="text-sm">{r.message}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
