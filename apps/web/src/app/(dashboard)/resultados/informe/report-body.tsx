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
import type { AssessmentReportItemRow, AssessmentReportResponse, ItemReportFlag } from '@soe/types';
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
import { SummaryCard } from '../components/summary-card';
import {
  formatAchievement,
  performanceLevelLabel,
  PERFORMANCE_LEVEL_BAR_CLASS,
} from '../components/performance-level';
import { ReportExportButton } from './report-export-button';

// ─────────────────────────────────────────────────────────────────────────────
// Cuerpo del informe de evaluación (H6.13). Server Component: sólo presenta los
// datos ya calculados por el backend. Los botones de exportación son los únicos
// fragmentos cliente (ExportButton).
// ─────────────────────────────────────────────────────────────────────────────

// Umbrales de color para dificultad (p) y discriminación (D). Mismos cortes que
// usa el backend para los flags, replicados aquí sólo para la codificación visual.
const DIFFICULTY_LOW = 40;
const DIFFICULTY_MID = 60;
const DISCRIMINATION_LOW = 0.2;
const DISCRIMINATION_MID = 0.3;

const FLAG_META: Record<ItemReportFlag, { label: string; className: string }> = {
  critical: {
    label: 'Crítico',
    className: 'border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  },
  low_discrimination: {
    label: 'Baja discriminación',
    className:
      'border-transparent bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200',
  },
  strong_distractor: {
    label: 'Distractor potente',
    className:
      'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  },
  easy: {
    label: 'Muy fácil',
    className:
      'border-transparent bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  },
};

const PRIORITY_META: Record<'high' | 'medium' | 'low', { label: string; className: string }> = {
  high: {
    label: 'Alta',
    className: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  },
  medium: {
    label: 'Media',
    className: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  },
  low: {
    label: 'Baja',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
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

function fmtDiscrimination(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '—';
  return value.toFixed(2);
}

function difficultyClass(value: number | null): string {
  if (value === null) return 'text-muted-foreground';
  if (value < DIFFICULTY_LOW) return 'text-red-600 dark:text-red-400 font-semibold';
  if (value < DIFFICULTY_MID) return 'text-amber-600 dark:text-amber-400 font-medium';
  return 'text-emerald-600 dark:text-emerald-400 font-medium';
}

function discriminationClass(value: number | null): string {
  if (value === null) return 'text-muted-foreground';
  if (value < DISCRIMINATION_LOW) return 'text-red-600 dark:text-red-400 font-semibold';
  if (value < DISCRIMINATION_MID) return 'text-amber-600 dark:text-amber-400 font-medium';
  return 'text-emerald-600 dark:text-emerald-400 font-medium';
}

export function ReportBody({ report }: { report: AssessmentReportResponse }) {
  const { summary } = report;

  return (
    <div className="space-y-6">
      <FichaTecnica report={report} />

      {/* 1. Síntesis ejecutiva */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="% Logro promedio"
          value={formatAchievement(summary.averageAchievement)}
          hint={`Nivel: ${performanceLevelLabel(summary.performanceLevel)}`}
          icon={Target}
        />
        {/* TKT-04: notas/escala solo si el instrumento tiene escala configurada.
            Sin escala, se ocultan estas tarjetas (no se muestra el default 4.0). */}
        {summary.hasGradingScale ? (
          <>
            <SummaryCard
              label="Aprobación"
              value={summary.passingRate === null ? '—' : `${summary.passingRate.toFixed(1)}%`}
              hint={
                summary.passingGrade === null
                  ? undefined
                  : `Nota de corte: ${summary.passingGrade.toFixed(1)}`
              }
              icon={CheckCircle2}
            />
            <SummaryCard
              label="Nota promedio"
              value={summary.averageGrade === null ? '—' : summary.averageGrade.toFixed(1)}
              hint={summary.averageGrade === null ? undefined : 'Promedio del curso evaluado'}
              icon={GraduationCap}
            />
          </>
        ) : null}
        <SummaryCard
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
      <DistributionBar distribution={report.distribution} />

      {/* 3. Comparativa por curso */}
      <CourseComparison report={report} />

      {/* 4. Fortalezas y brechas por habilidad */}
      <SkillsSection report={report} />

      {/* 5. Análisis psicométrico de ítems */}
      <ItemsSection report={report} />

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
            <TrendingUp className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
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
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
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
            <TrendingDown className="size-4 text-red-600 dark:text-red-400" aria-hidden />
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
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-red-500" />
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
                        ? 'text-red-600 dark:text-red-400'
                        : r.gapVsAverage !== null && r.gapVsAverage > 0
                          ? 'text-emerald-600 dark:text-emerald-400'
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

function SkillsSection({ report }: { report: AssessmentReportResponse }) {
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
                  <PerformanceBadge level={s.performanceLevel} />
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

// ── Ítems (psicometría) ───────────────────────────────────────────────────────

function ItemsSection({ report }: { report: AssessmentReportResponse }) {
  const items = report.items;
  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Análisis de preguntas</CardTitle>
        <p className="text-sm text-muted-foreground">
          Dificultad (p): % de logro — bajo = difícil. Discriminación (D): distingue a quienes
          dominan el contenido — D&nbsp;&lt;&nbsp;0,2 sugiere revisar la pregunta, no el
          aprendizaje.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">N°</TableHead>
                <TableHead>Habilidad / contenido</TableHead>
                <TableHead className="text-center">Clave</TableHead>
                <TableHead className="text-right">Dificultad</TableHead>
                <TableHead className="text-right">Discrim.</TableHead>
                <TableHead className="hidden md:table-cell">Distractor top</TableHead>
                <TableHead>Alertas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i) => (
                <ItemRow key={i.itemId} item={i} />
              ))}
            </TableBody>
          </Table>
        </div>
        <FlagsLegend />
      </CardContent>
    </Card>
  );
}

function ItemRow({ item }: { item: AssessmentReportItemRow }) {
  const label = item.skillName ?? item.contentName ?? '—';
  const secondary = item.skillName && item.contentName ? item.contentName : null;
  return (
    <TableRow>
      <TableCell className="font-medium">{item.position}</TableCell>
      <TableCell>
        <span className="block text-sm">{label}</span>
        {secondary ? (
          <span className="block text-xs text-muted-foreground">{secondary}</span>
        ) : null}
      </TableCell>
      <TableCell className="text-center font-mono text-xs">{item.correctKey ?? '—'}</TableCell>
      <TableCell className={cn('text-right tabular-nums', difficultyClass(item.difficulty))}>
        {item.difficulty === null ? '—' : `${item.difficulty.toFixed(0)}%`}
      </TableCell>
      <TableCell
        className={cn('text-right tabular-nums', discriminationClass(item.discrimination))}
      >
        {fmtDiscrimination(item.discrimination)}
      </TableCell>
      <TableCell className="hidden md:table-cell text-sm">
        {item.topDistractorKey ? (
          <span>
            <span className="font-mono">{item.topDistractorKey}</span>
            {item.topDistractorRate !== null ? (
              <span className="text-muted-foreground"> ({item.topDistractorRate.toFixed(0)}%)</span>
            ) : null}
          </span>
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {item.flags.map((f) => (
            <span
              key={f}
              className={cn(
                'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                FLAG_META[f].className,
              )}
            >
              {FLAG_META[f].label}
            </span>
          ))}
        </div>
      </TableCell>
    </TableRow>
  );
}

function FlagsLegend() {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
      <span>
        <strong className="text-foreground">Crítico</strong>: &lt;40% de logro — contenido no
        logrado.
      </span>
      <span>
        <strong className="text-foreground">Baja discriminación</strong>: D&nbsp;&lt;&nbsp;0,2 —
        posible problema de redacción/clave.
      </span>
      <span>
        <strong className="text-foreground">Distractor potente</strong>: una alternativa incorrecta
        atrae más que la clave.
      </span>
      <span>
        <strong className="text-foreground">Muy fácil</strong>: ≥85% de logro.
      </span>
    </div>
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
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
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
                    <PerformanceBadge level={s.performanceLevel} />
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
          <Lightbulb className="size-4 text-blue-600 dark:text-blue-400" aria-hidden />
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
