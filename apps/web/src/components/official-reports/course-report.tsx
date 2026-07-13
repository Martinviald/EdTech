import type { Route } from 'next';
import Link from 'next/link';
import type {
  OfficialCourseReportResponse,
  OfficialSpecTableRow,
  OfficialCourseStudentRow,
} from '@soe/types';
import { cn } from '@/lib/utils';
import {
  PERFORMANCE_LEVEL_CHART_COLOR,
  PERFORMANCE_LEVEL_LABELS,
  PERFORMANCE_LEVEL_ORDER,
  PERFORMANCE_LEVEL_BADGE_CLASS,
  performanceLevelLabel,
} from '@/app/(dashboard)/resultados/components/performance-level';
import {
  ReportShell,
  ReportCover,
  ReportSection,
  DisclaimerBox,
  GuideQuestionsBox,
  fmtPct,
  fmtDate,
  fmtDateTime,
} from './report-primitives';
import {
  HBarChart,
  DonutChart,
  StudentDotPlot,
  type BarDatum,
  type DonutSlice,
} from './report-charts';
import { resolveDisclaimers } from './report-copy';

// ─────────────────────────────────────────────────────────────────────────────
// TKT-24 — Informe oficial por curso. Server Component: recibe el
// OfficialCourseReportResponse ya cargado y maqueta las 6 secciones.
// El énfasis de la Sección 2 depende de `meta.variant` (Diagnóstico vs
// Monitoreo/Cierre), pero ambas vistas de dato siempre se muestran.
// ─────────────────────────────────────────────────────────────────────────────

const DEV_CATEGORY_LABELS: Record<string, string> = {
  RC: 'Respuesta correcta',
  RPC: 'Respuesta parcialmente correcta',
  RI: 'Respuesta incorrecta',
  N: 'No responde',
};

export function CourseReport({
  report,
  studentReportBasePath,
}: {
  report: OfficialCourseReportResponse;
  /** Base para enlazar el informe individual por alumno (TKT-26). */
  studentReportBasePath?: string;
}) {
  const { meta, generalResult, skillAxes, specTable, studentResults, reflectionPrompts } = report;
  const disclaimers = resolveDisclaimers(meta.disclaimers);
  const isDiagnostic = meta.variant === 'requires_support';

  const coverMeta = [
    { label: 'Establecimiento', value: meta.orgName },
    { label: 'RBD', value: meta.rbd ?? '—' },
    { label: 'Director(a)', value: meta.directorName ?? '—' },
    { label: 'Docente', value: meta.teacherName ?? '—' },
    {
      label: 'Curso',
      value: meta.classGroup
        ? [meta.classGroup.name, meta.classGroup.gradeName].filter(Boolean).join(' · ')
        : '—',
    },
    { label: 'Asignatura', value: meta.subjectName ?? '—' },
    { label: 'Estudiantes considerados', value: String(meta.studentsConsidered) },
    { label: 'Aplicada', value: fmtDate(meta.administeredAt) },
    { label: 'Generado', value: fmtDateTime(meta.generatedAt) },
  ];

  const subtitle = [meta.instrumentName, meta.periodLabel ?? meta.period]
    .filter(Boolean)
    .join(' · ');

  return (
    <ReportShell>
      {/* ── Sección 1 — Portada + metadatos ── */}
      <ReportCover
        eyebrow="Informe de resultados por curso"
        title={`${meta.subjectName ?? meta.instrumentName}`}
        subtitle={subtitle}
        meta={coverMeta}
      />
      <DisclaimerBox disclaimers={disclaimers} />

      {/* ── Sección 2 — Resultado general ── */}
      <ReportSection
        index={1}
        title="Resultado general del curso"
        description={
          isDiagnostic
            ? 'Diagnóstico: se destaca la cantidad de estudiantes que requieren mayor apoyo para enfrentar el año.'
            : 'Se destaca la distribución de estudiantes por nivel de logro.'
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <GeneralStat
            label="Logro promedio del curso"
            value={fmtPct(generalResult.averageAchievement)}
            hint={performanceLevelLabel(generalResult.performanceLevel)}
          />
          <GeneralStat
            label="Estudiantes que requieren mayor apoyo"
            value={String(generalResult.requiresSupportCount)}
            hint={`${fmtPct(generalResult.requiresSupportPercentage)} del curso`}
            emphasized={isDiagnostic}
          />
          <GeneralStat
            label="Estudiantes considerados"
            value={String(generalResult.studentsConsidered)}
          />
        </div>

        {!isDiagnostic ? (
          <div className="rounded-md border p-4">
            <p className="mb-4 text-sm font-medium">Resultados según niveles de logro</p>
            <DonutChart slices={levelSlices(generalResult.distribution)} />
          </div>
        ) : null}
      </ReportSection>

      {/* ── Sección 3 — Ejes de habilidad ── */}
      <ReportSection
        index={2}
        title="Resultados según ejes de habilidad"
        description="Porcentaje promedio de logro del curso por eje/habilidad, ordenado de menor a mayor (brechas primero)."
      >
        <HBarChart
          data={skillAxes.map(
            (axis): BarDatum => ({
              key: axis.nodeId,
              label: axis.nodeName,
              sublabel: axis.nodeCode,
              value: axis.averageAchievement,
              color: axis.performanceLevel
                ? PERFORMANCE_LEVEL_CHART_COLOR[axis.performanceLevel]
                : null,
              tooltip: [
                ...(axis.performanceLevel
                  ? [
                      {
                        label: 'Nivel',
                        value: performanceLevelLabel(axis.performanceLevel),
                        color: PERFORMANCE_LEVEL_CHART_COLOR[axis.performanceLevel],
                      },
                    ]
                  : []),
                { label: 'Estudiantes evaluados', value: axis.studentsAssessed },
              ],
            }),
          )}
        />
      </ReportSection>

      {/* ── Sección 4 — Tabla de especificaciones ── */}
      <ReportSection
        index={3}
        title="Resultados por pregunta"
        description="Tabla de especificaciones: para cada pregunta, el OA/eje/habilidad evaluado y la distribución de respuestas (la alternativa correcta en negrita)."
      >
        <SpecTable rows={specTable} />
      </ReportSection>

      {/* ── Sección 5 — Resultados por estudiante ── */}
      <ReportSection
        index={4}
        title="Resultados por estudiante"
        description="Una fila por estudiante: el punto marca su porcentaje de logro sobre las bandas de nivel del instrumento (color por nivel), para leer visualmente en qué nivel cae cada alumno. El nivel más bajo (Insuficiente) corresponde a quienes requieren mayor apoyo."
      >
        <StudentDotPlot students={studentResults} />
        <p className="text-sm text-muted-foreground">
          Estudiantes que requieren mayor apoyo:{' '}
          <span className="font-semibold text-foreground">
            {generalResult.requiresSupportCount}
          </span>{' '}
          de {generalResult.studentsConsidered}
        </p>
        <StudentTable students={studentResults} basePath={studentReportBasePath} />
      </ReportSection>

      {/* ── Sección 6 — Conclusiones / preguntas guía ── */}
      <ReportSection index={5} title="Conclusiones preliminares">
        <GuideQuestionsBox prompts={reflectionPrompts} />
      </ReportSection>
    </ReportShell>
  );
}

function GeneralStat({
  label,
  value,
  hint,
  emphasized,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasized?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-md border p-4',
        emphasized && 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40',
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function levelSlices(
  distribution: OfficialCourseReportResponse['generalResult']['distribution'],
): DonutSlice[] {
  const byLevel = new Map(distribution.map((b) => [b.level, b]));
  return PERFORMANCE_LEVEL_ORDER.map((level) => {
    const bucket = byLevel.get(level);
    return {
      key: level,
      label: PERFORMANCE_LEVEL_LABELS[level],
      value: bucket?.count ?? 0,
      color: PERFORMANCE_LEVEL_CHART_COLOR[level],
      percentage: bucket?.percentage ?? 0,
    };
  });
}

// ── Tabla de especificaciones ─────────────────────────────────────────────────

function SpecTable({ rows }: { rows: OfficialSpecTableRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin preguntas para mostrar.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">N°</th>
            <th className="px-3 py-2 font-medium">OA</th>
            <th className="px-3 py-2 font-medium">Tipo de texto</th>
            <th className="px-3 py-2 font-medium">Eje</th>
            <th className="px-3 py-2 font-medium">Habilidad</th>
            <th className="px-3 py-2 font-medium">Indicador</th>
            <th className="px-3 py-2 font-medium">Distribución de respuestas</th>
            <th className="px-3 py-2 text-right font-medium">% Logro</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.itemId} className="border-b align-top last:border-0">
              <td className="px-3 py-2 font-medium tabular-nums">{row.position}</td>
              <td className="px-3 py-2">{row.oaCode ?? '—'}</td>
              <td className="px-3 py-2">{row.textType ?? '—'}</td>
              <td className="px-3 py-2">{row.axis ?? '—'}</td>
              <td className="px-3 py-2">{row.skill ?? '—'}</td>
              <td className="px-3 py-2">{row.indicator ?? '—'}</td>
              <td className="px-3 py-2">
                <ResponseDistribution row={row} />
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtPct(row.correctRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResponseDistribution({ row }: { row: OfficialSpecTableRow }) {
  // Preguntas de desarrollo → distribución RC/RPC/RI/N.
  if (row.developmentDistribution && row.developmentDistribution.length > 0) {
    return (
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {row.developmentDistribution.map((d) => (
          <li key={d.category} className="whitespace-nowrap">
            <span className="font-medium">{d.category}</span>
            <span className="ml-1 text-muted-foreground" title={DEV_CATEGORY_LABELS[d.category]}>
              {fmtPct(d.percentage, 0)}
            </span>
          </li>
        ))}
      </ul>
    );
  }
  // Selección múltiple → % por alternativa, la correcta en negrita.
  if (row.alternatives.length > 0) {
    return (
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {row.alternatives.map((alt) => (
          <li key={alt.key} className="whitespace-nowrap">
            <span
              className={cn(alt.isCorrect ? 'font-bold text-foreground' : 'font-medium')}
              title={alt.text ?? undefined}
            >
              {alt.key}
              {alt.isCorrect ? ' ✓' : ''}
            </span>
            <span className="ml-1 text-muted-foreground">{fmtPct(alt.percentage, 0)}</span>
          </li>
        ))}
      </ul>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

function StudentTable({
  students,
  basePath,
}: {
  students: OfficialCourseStudentRow[];
  basePath?: string;
}) {
  if (students.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">Estudiante</th>
            <th className="px-3 py-2 font-medium">RUT</th>
            <th className="px-3 py-2 text-right font-medium">% Logro</th>
            <th className="px-3 py-2 font-medium">Nivel</th>
            {basePath ? <th className="px-3 py-2 font-medium print:hidden">Informe</th> : null}
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <tr key={s.studentId} className="border-b align-middle last:border-0">
              <td className="px-3 py-2 font-medium">
                {s.studentFullName}
                {s.requiresSupport ? (
                  <span className="ml-2 rounded-sm bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950 dark:text-red-200">
                    Requiere apoyo
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground">{s.studentRut}</td>
              <td className="px-3 py-2 text-right tabular-nums">{fmtPct(s.achievement)}</td>
              <td className="px-3 py-2">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold',
                    s.performanceLevel
                      ? PERFORMANCE_LEVEL_BADGE_CLASS[s.performanceLevel]
                      : 'text-muted-foreground',
                  )}
                >
                  {performanceLevelLabel(s.performanceLevel)}
                </span>
              </td>
              {basePath ? (
                <td className="px-3 py-2 print:hidden">
                  <Link
                    href={`${basePath}/${s.studentId}` as Route}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    Ver informe
                  </Link>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
