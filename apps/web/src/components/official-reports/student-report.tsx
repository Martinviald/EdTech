import type { OfficialStudentReportResponse, OfficialStudentItemRow } from '@soe/types';
import { cn } from '@/lib/utils';
import {
  PERFORMANCE_LEVEL_BADGE_CLASS,
  performanceLevelLabel,
} from '@/app/(dashboard)/resultados/components/performance-level';
import {
  ReportShell,
  ReportCover,
  ReportSection,
  DisclaimerBox,
  HBarChart,
  fmtPct,
  fmtDate,
  fmtDateTime,
} from './report-primitives';
import { resolveDisclaimers } from './report-copy';

// ─────────────────────────────────────────────────────────────────────────────
// TKT-26 — Informe individual por estudiante. Server Component. Sólo GENERACIÓN
// (el envío por correo al apoderado queda diferido). Contiene PII: el scoping lo
// aplica el backend (un profesor sólo ve alumnos de sus cursos).
// ─────────────────────────────────────────────────────────────────────────────

export function StudentReport({ report }: { report: OfficialStudentReportResponse }) {
  const { meta, result, skills, items } = report;
  const disclaimers = resolveDisclaimers(meta.disclaimers);

  const coverMeta = [
    { label: 'Estudiante', value: meta.student.fullName },
    { label: 'RUT', value: meta.student.rut },
    {
      label: 'Curso',
      value: meta.classGroup
        ? [meta.classGroup.name, meta.classGroup.gradeName].filter(Boolean).join(' · ')
        : '—',
    },
    { label: 'Establecimiento', value: meta.orgName },
    { label: 'Asignatura', value: meta.subjectName ?? '—' },
    { label: 'Instrumento', value: meta.instrumentName },
    { label: 'Aplicada', value: fmtDate(meta.administeredAt) },
    { label: 'Generado', value: fmtDateTime(meta.generatedAt) },
  ];

  return (
    <ReportShell>
      <ReportCover
        eyebrow="Informe individual del estudiante"
        title={meta.student.fullName}
        subtitle={[meta.subjectName ?? meta.instrumentName, meta.periodLabel ?? meta.period]
          .filter(Boolean)
          .join(' · ')}
        meta={coverMeta}
      />
      <DisclaimerBox disclaimers={disclaimers} />

      {/* ── Resultado global ── */}
      <ReportSection index={1} title="Resultado general">
        <div className="grid gap-4 sm:grid-cols-4">
          <Stat label="% de logro" value={fmtPct(result.achievement)} />
          <Stat
            label="Nivel de logro"
            value={performanceLevelLabel(result.performanceLevel)}
            badge={
              result.performanceLevel
                ? PERFORMANCE_LEVEL_BADGE_CLASS[result.performanceLevel]
                : undefined
            }
          />
          <Stat
            label="Respuestas correctas"
            value={`${result.correctCount} / ${result.totalItems}`}
          />
          <Stat
            label="Promedio del curso"
            value={fmtPct(result.classAverageAchievement)}
            hint="Referencia"
          />
        </div>
        {result.requiresSupport ? (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
            Este estudiante se ubica en el nivel de logro más bajo y requiere mayor apoyo.
          </div>
        ) : null}
      </ReportSection>

      {/* ── Logro por habilidad ── */}
      <ReportSection
        index={2}
        title="Logro por eje / habilidad"
        description="Ordenado de menor a mayor logro (áreas a reforzar primero)."
      >
        <HBarChart
          data={skills.map((s) => ({
            key: s.nodeId,
            label: s.nodeName,
            sublabel: `${s.correctCount}/${s.totalCount}`,
            value: s.percentage,
          }))}
        />
      </ReportSection>

      {/* ── Detalle por pregunta ── */}
      <ReportSection index={3} title="Detalle por pregunta">
        <ItemsTable items={items} />
      </ReportSection>
    </ReportShell>
  );
}

function Stat({
  label,
  value,
  hint,
  badge,
}: {
  label: string;
  value: string;
  hint?: string;
  badge?: string;
}) {
  return (
    <div className="rounded-md border p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {badge ? (
        <span
          className={cn(
            'mt-1 inline-flex items-center rounded-full border px-2 py-0.5 text-sm font-semibold',
            badge,
          )}
        >
          {value}
        </span>
      ) : (
        <p className="mt-1 text-2xl font-bold tracking-tight">{value}</p>
      )}
      {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function ItemsTable({ items }: { items: OfficialStudentItemRow[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin preguntas para mostrar.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[600px] border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">N°</th>
            <th className="px-3 py-2 font-medium">OA</th>
            <th className="px-3 py-2 font-medium">Eje</th>
            <th className="px-3 py-2 font-medium">Habilidad</th>
            <th className="px-3 py-2 text-center font-medium">Respuesta</th>
            <th className="px-3 py-2 text-center font-medium">Correcta</th>
            <th className="px-3 py-2 text-center font-medium">Resultado</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.itemId} className="border-b align-top last:border-0">
              <td className="px-3 py-2 font-medium tabular-nums">{it.position}</td>
              <td className="px-3 py-2">{it.oaCode ?? '—'}</td>
              <td className="px-3 py-2">{it.axis ?? '—'}</td>
              <td className="px-3 py-2">{it.skill ?? '—'}</td>
              <td className="px-3 py-2 text-center font-medium">
                {it.selectedKey ?? <span className="text-muted-foreground">— </span>}
              </td>
              <td className="px-3 py-2 text-center text-muted-foreground">
                {it.correctKey ?? '—'}
              </td>
              <td className="px-3 py-2 text-center">
                <ResultMark item={it} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultMark({ item }: { item: OfficialStudentItemRow }) {
  // Sin respuesta.
  if (item.selectedKey === null && item.isCorrect === null) {
    return <span className="text-xs text-muted-foreground">Sin responder</span>;
  }
  // Puntaje parcial (desarrollo): 0 < score < maxScore.
  if (item.isCorrect === null && item.score !== null) {
    const partial = item.score > 0 && item.score < item.maxScore;
    return (
      <span
        className={cn(
          'text-xs font-medium',
          item.score >= item.maxScore
            ? 'text-emerald-600 dark:text-emerald-400'
            : partial
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-red-600 dark:text-red-400',
        )}
      >
        {item.score}/{item.maxScore}
      </span>
    );
  }
  return item.isCorrect ? (
    <span className="text-emerald-600 dark:text-emerald-400" title="Correcta">
      ✓
    </span>
  ) : (
    <span className="text-red-600 dark:text-red-400" title="Incorrecta">
      ✗
    </span>
  );
}
