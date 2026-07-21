import type { Route } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type {
  OfficialCourseReportResponse,
  OfficialSpecTableRow,
  OfficialCourseStudentRow,
  PerformanceBandDistributionBucket,
  PerformanceLevel,
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
  StudentBandStrip,
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
  // Cierre: la figura "Estudiantes que muestran avance o mejora" lista el SUBCONJUNTO
  // del curso que avanzó respecto del Monitoreo Intermedio, cada alumno con su nivel
  // previo (Monitoreo) y su nivel de Cierre. Se muestra el avance sólo cuando el
  // informe es de Cierre y trae el nivel previo por alumno (`priorBandLabel`); en
  // Monitoreo/Diagnóstico §5 queda como está (sin columna de nivel previo).
  const isCierre = meta.period?.toLowerCase().includes('cierre') ?? false;
  const showAdvance = isCierre && studentResults.some((s) => s.priorBandLabel != null);
  // La distribución por nivel (torta §2) y "requiere apoyo" SÍ pueden existir en un
  // informe agregado si trae el Gráfico 1 (`assessment_level_stats`). Se condicionan a
  // que la distribución venga con datos —no a la granularidad— para no ocultar una
  // torta poblada ni mostrar un 0 engañoso cuando falta el Gráfico 1.
  const hasLevelDistribution = generalResult.distribution.some((b) => b.count > 0);
  // Bandas reales del instrumento (ej. DIA I/II/III). Cuando vienen con datos, la
  // torta §2 y el badge §5 se renderizan con sus labels/colores en lugar de la
  // escala fija de 4 niveles. Sin bandas → fallback a los 4 niveles (sin regresión).
  const bandDistribution = report.bandDistribution;
  const hasBandDistribution = !!bandDistribution && bandDistribution.some((b) => b.count > 0);

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
            value={hasLevelDistribution ? String(generalResult.requiresSupportCount) : '—'}
            hint={
              hasLevelDistribution
                ? `${fmtPct(generalResult.requiresSupportPercentage)} del curso`
                : 'No disponible: este informe no incluye la distribución por nivel de logro.'
            }
            emphasized={isDiagnostic && hasLevelDistribution}
          />
          <GeneralStat
            label="Estudiantes considerados"
            value={String(generalResult.studentsConsidered)}
          />
        </div>

        {!isDiagnostic ? (
          <div className="rounded-md border p-4">
            <p className="mb-4 text-sm font-medium">Resultados según niveles de logro</p>
            {hasBandDistribution ? (
              <DonutChart slices={bandSlices(bandDistribution!)} />
            ) : hasLevelDistribution ? (
              <DonutChart slices={levelSlices(generalResult.distribution)} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No disponible: este informe no incluye la distribución por nivel de logro de los
                estudiantes.
              </p>
            )}
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
        title={
          showAdvance
            ? 'Estudiantes que avanzaron o mejoraron respecto del Monitoreo Intermedio'
            : 'Resultados por estudiante'
        }
        description={
          showAdvance
            ? 'Subconjunto del curso (no toda la clase): sólo los estudiantes que avanzaron de nivel respecto del Monitoreo Intermedio. Cada fila muestra el avance de su nivel previo (Monitoreo) a su nivel de Cierre.'
            : isDiagnostic
              ? 'Una fila por estudiante: si requiere mayor apoyo (lado del umbral, señal confiable del diagnóstico) y su posición estimada. El diagnóstico no clasifica en niveles I/II/III, y la posición es una estimación, no un puntaje oficial.'
              : 'Una fila por estudiante: el punto marca su porcentaje de logro sobre las bandas de nivel del instrumento (color por nivel), para leer visualmente en qué nivel cae cada alumno. El nivel más bajo (Insuficiente) corresponde a quienes requieren mayor apoyo.'
        }
      >
        {studentResults.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Este informe se cargó de forma agregada por curso y no incluye los resultados
            individuales de cada estudiante.
          </p>
        ) : (
          <>
            {/* El dot-plot posiciona cada punto por su % de logro sobre las bandas.
                En Diagnóstico el "logro" es una posición APROXIMADA (no un score sobre
                las bandas), así que no se muestra para no presentarla como oficial.
                Fuera de Diagnóstico se muestra sólo si hay al menos una fila con logro
                (un informe agregado band-only no trae %). La nómina siempre se ve. */}
            {!isDiagnostic && studentResults.some((s) => s.achievement !== null) && (
              <StudentDotPlot students={studentResults} />
            )}
            <p className="text-sm text-muted-foreground">
              {showAdvance ? (
                <>
                  Estudiantes que avanzaron o mejoraron:{' '}
                  <span className="font-semibold text-foreground">
                    {studentResults.filter((s) => s.priorBandLabel != null).length}
                  </span>{' '}
                  (subconjunto del curso, no toda la clase)
                </>
              ) : (
                <>
                  Estudiantes que requieren mayor apoyo:{' '}
                  <span className="font-semibold text-foreground">
                    {generalResult.requiresSupportCount}
                  </span>{' '}
                  de {generalResult.studentsConsidered}
                </>
              )}
            </p>
            <StudentTable
              students={studentResults}
              basePath={studentReportBasePath}
              isDiagnostic={isDiagnostic}
              showAdvance={showAdvance}
            />
          </>
        )}
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
        emphasized && 'border-destructive/30 bg-destructive/10',
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

/**
 * Nivel legacy equivalente de una banda por la posición relativa de su `order`
 * dentro del set (misma proyección que `bandToLegacyLevel` del backend). Sólo se
 * usa para heredar el color/estilo de la paleta de niveles cuando la banda no trae
 * un color propio — la etiqueta mostrada es SIEMPRE la real de la banda.
 */
function bandLegacyLevel(order: number, orders: readonly number[]): PerformanceLevel {
  const n = orders.length;
  if (n <= 1) return 'adequate';
  const sorted = [...orders].sort((a, b) => a - b);
  const idx = sorted.indexOf(order);
  const ratio = idx / (n - 1);
  const bucket = Math.min(
    PERFORMANCE_LEVEL_ORDER.length - 1,
    Math.round(ratio * (PERFORMANCE_LEVEL_ORDER.length - 1)),
  );
  return PERFORMANCE_LEVEL_ORDER[bucket]!;
}

/** Color (hex) de una banda: el suyo si es hex, si no el del nivel equivalente. */
function bandColor(bucket: PerformanceBandDistributionBucket, orders: readonly number[]): string {
  if (bucket.color && bucket.color.startsWith('#')) return bucket.color;
  return PERFORMANCE_LEVEL_CHART_COLOR[bandLegacyLevel(bucket.order, orders)];
}

/** Torta desde la distribución por banda del instrumento (labels/colores reales). */
function bandSlices(distribution: PerformanceBandDistributionBucket[]): DonutSlice[] {
  const ordered = [...distribution].sort((a, b) => a.order - b.order);
  const orders = ordered.map((b) => b.order);
  return ordered.map((b) => ({
    key: b.key,
    label: b.label,
    value: b.count,
    color: bandColor(b, orders),
    percentage: b.percentage,
  }));
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
  isDiagnostic = false,
  showAdvance = false,
}: {
  students: OfficialCourseStudentRow[];
  basePath?: string;
  /**
   * Diagnóstico: no clasifica por niveles I/II/III. Se muestra "Requiere apoyo"
   * (Sí/No, la señal confiable) + "Posición (est.)" en vez de "% Logro" + "Nivel".
   */
  isDiagnostic?: boolean;
  /**
   * Cierre con nivel previo por alumno: se agrega la columna "Avance" que muestra el
   * paso `nivel previo (Monitoreo) → nivel de Cierre`. Sólo aplica a Cierre.
   */
  showAdvance?: boolean;
}) {
  if (students.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">Estudiante</th>
            {isDiagnostic ? (
              <th className="px-3 py-2 font-medium">Nivel de logro</th>
            ) : (
              <>
                <th className="px-3 py-2 text-right font-medium">% Logro</th>
                <th className="px-3 py-2 font-medium">Nivel</th>
                {showAdvance ? <th className="px-3 py-2 font-medium">Avance</th> : null}
              </>
            )}
            {basePath ? (
              <th className="w-10 px-3 py-2 font-medium print:hidden">
                <span className="sr-only">Informe</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {students.map((s) => (
            <tr key={s.studentId} className="border-b align-middle last:border-0">
              <td className="px-3 py-2 font-medium">
                {s.studentFullName}
                {/* Fuera de Diagnóstico el aviso "Requiere apoyo" va junto al nombre;
                    en Diagnóstico la franja de logro lo muestra por posición. */}
                {!isDiagnostic && s.requiresSupport ? (
                  <span className="ml-2 rounded-sm bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">

                    Requiere apoyo
                  </span>
                ) : null}
              </td>
              {isDiagnostic ? (
                <td className="px-3 py-2">
                  {/* Misma figura del informe de monitoreo: bandas de nivel con el
                      punto en el % de logro; requiere apoyo cae a la izquierda. */}
                  <StudentBandStrip
                    achievement={s.achievement}
                    performanceLevel={s.performanceLevel}
                    requiresSupport={s.requiresSupport}
                  />
                </td>
              ) : (
                <>
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
                      {/* Label REAL de la banda del instrumento (ej. "Nivel II"); sin
                          bandas cae a la etiqueta legacy. El color viene del nivel
                          equivalente ya resuelto en el backend (`performanceLevel`). */}
                      {s.bandLabel ?? performanceLevelLabel(s.performanceLevel)}
                    </span>
                  </td>
                  {showAdvance ? (
                    <td className="px-3 py-2">
                      {/* Avance del nivel previo (Monitoreo) al nivel de Cierre. Sin
                          nivel previo → "—" (alumno del curso que no está en el
                          subconjunto que avanzó). */}
                      {s.priorBandLabel != null ? (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium">
                          <span className="text-muted-foreground">{s.priorBandLabel}</span>
                          <span aria-hidden className="text-muted-foreground">
                            →
                          </span>
                          <span className="font-semibold text-foreground">
                            {s.bandLabel ?? performanceLevelLabel(s.performanceLevel)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  ) : null}
                </>
              )}
              {basePath ? (
                <td className="px-3 py-2 text-right print:hidden">
                  <Link
                    href={`${basePath}/${s.studentId}` as Route}
                    aria-label={`Ver informe de ${s.studentFullName}`}
                    title="Ver informe del estudiante"
                    className="inline-flex size-7 items-center justify-center rounded-md text-primary hover:bg-muted"
                  >
                    <ArrowRight className="size-4" aria-hidden />
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
