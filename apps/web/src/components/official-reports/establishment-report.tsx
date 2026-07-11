import type {
  OfficialEstablishmentReportResponse,
  EstablishmentSubjectSection,
  EstablishmentGradeColumn,
  SexComparisonResult,
} from '@soe/types';
import { cn } from '@/lib/utils';
import {
  ReportShell,
  ReportCover,
  ReportSection,
  DisclaimerBox,
  InfoBox,
  fmtPct,
  fmtDateTime,
} from './report-primitives';
import { resolveDisclaimers, resolveLevelDefinitions } from './report-copy';
import {
  DIA_LEVEL_ORDER,
  DIA_LEVEL_OF,
  DIA_LEVEL_LABELS,
  diaLevelBadgeClass,
  type DiaLevel,
} from './dia-levels';

// ─────────────────────────────────────────────────────────────────────────────
// TKT-25 — Informe de establecimiento (Área Académica). Server Component.
// Reproduce las Tablas 1.1–1.9: una por asignatura con niveles de logro I/II/III
// por grado, comparación por sexo, y conteos. El colapso de los 4 niveles de la
// plataforma a I/II/III lo aplica el frontend (ver `dia-levels.ts`).
// ─────────────────────────────────────────────────────────────────────────────

/** Mapea el resultado de comparación por sexo al símbolo oficial. */
const SEX_SYMBOL: Record<SexComparisonResult, string> = {
  more_female: '+M',
  more_male: '+H',
  no_difference: '',
  insufficient_sample: '*',
};
const SEX_TITLE: Record<SexComparisonResult, string> = {
  more_female: 'Mujeres significativamente mayor',
  more_male: 'Hombres significativamente mayor',
  no_difference: 'Sin diferencia significativa',
  insufficient_sample: 'Muestra insuficiente para el cálculo',
};

export function EstablishmentReport({
  report,
}: {
  report: OfficialEstablishmentReportResponse;
}) {
  const { meta, subjects, sexDataAvailable, scopeNotes } = report;
  const disclaimers = resolveDisclaimers(meta.disclaimers);
  const levelDefinitions = resolveLevelDefinitions(report.levelDefinitions);

  const coverMeta = [
    { label: 'Establecimiento', value: meta.orgName },
    { label: 'RBD', value: meta.rbd ?? '—' },
    { label: 'Director(a)', value: meta.directorName ?? '—' },
    { label: 'Comuna', value: meta.commune ?? '—' },
    { label: 'Año académico', value: meta.academicYear ? String(meta.academicYear) : '—' },
    { label: 'Momento', value: meta.periodLabel ?? meta.period ?? 'Todos' },
    { label: 'Generado', value: fmtDateTime(meta.generatedAt) },
  ];

  return (
    <ReportShell>
      <ReportCover
        eyebrow="Informe de resultados — Establecimiento"
        title={meta.orgName}
        subtitle={[meta.periodLabel ?? meta.period, meta.academicYear ? String(meta.academicYear) : null]
          .filter(Boolean)
          .join(' · ')}
        meta={coverMeta}
      />
      <DisclaimerBox disclaimers={disclaimers} />

      <ReportSection index={1} title="Área Académica">
        <InfoBox title="Definición de niveles de logro" items={levelDefinitions} />
        {scopeNotes.length > 0 ? (
          <InfoBox title="Alcance de este informe" items={scopeNotes} />
        ) : null}
      </ReportSection>

      {subjects.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay asignaturas con datos para el año/momento seleccionado.
        </p>
      ) : (
        subjects.map((subject, i) => (
          <SubjectBlock
            key={subject.subjectId}
            subject={subject}
            tableIndex={i + 1}
            sexDataAvailable={sexDataAvailable}
          />
        ))
      )}
    </ReportShell>
  );
}

function SubjectBlock({
  subject,
  tableIndex,
  sexDataAvailable,
}: {
  subject: EstablishmentSubjectSection;
  tableIndex: number;
  sexDataAvailable: boolean;
}) {
  return (
    <ReportSection title={subject.subjectName}>
      {/* Tabla 1.x — niveles de logro por grado */}
      <div className="space-y-2">
        <p className="text-sm font-medium">
          Tabla 1.{tableIndex} — Estudiantes por nivel de logro (%)
        </p>
        <LevelDistributionTable subject={subject} />
      </div>

      {/* Tabla 1.(4+x) — comparación por sexo, o nota si no hay dato */}
      <div className="space-y-2">
        <p className="text-sm font-medium">
          Tabla 1.{tableIndex + 4} — Comparación mujeres vs hombres
        </p>
        {sexDataAvailable && subject.sexComparison.length > 0 ? (
          <SexComparisonTable subject={subject} />
        ) : (
          <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            No se dispone de datos suficientes de sexo para calcular la comparación en esta
            asignatura.
          </p>
        )}
      </div>

      {/* Tabla 1.9 — conteos M/H/Total */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Tabla 1.9 — Cantidad de estudiantes evaluados</p>
        <CountsTable subject={subject} />
      </div>
    </ReportSection>
  );
}

function LevelDistributionTable({ subject }: { subject: EstablishmentSubjectSection }) {
  const { grades, levelDistribution } = subject;
  // Agrega las celdas (grade, platformLevel) al numeral I/II/III correspondiente.
  // clave: `${gradeId}|${diaLevel}` → { count, total }
  const agg = new Map<string, { count: number; total: number }>();
  const gradeTotal = new Map<string, number>();
  for (const cell of levelDistribution) {
    const dia = DIA_LEVEL_OF[cell.level];
    const key = `${cell.gradeId}|${dia}`;
    const prev = agg.get(key) ?? { count: 0, total: cell.total };
    agg.set(key, { count: prev.count + cell.count, total: cell.total });
    gradeTotal.set(cell.gradeId, cell.total);
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[480px] border-collapse text-sm">
        <thead>
          <GradeHeader grades={grades} firstCol="Nivel" />
        </thead>
        <tbody>
          {DIA_LEVEL_ORDER.map((dia) => (
            <tr key={dia} className="border-b last:border-0">
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold',
                    diaLevelBadgeClass(dia),
                  )}
                >
                  {DIA_LEVEL_LABELS[dia]}
                </span>
              </th>
              {grades.map((g) => {
                const entry = agg.get(`${g.gradeId}|${dia}`);
                const total = gradeTotal.get(g.gradeId) ?? 0;
                const pct = entry && total > 0 ? (entry.count / total) * 100 : null;
                return (
                  <td key={g.gradeId} className="px-3 py-2 text-center tabular-nums">
                    {total > 0 ? fmtPct(pct, 0) : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SexComparisonTable({ subject }: { subject: EstablishmentSubjectSection }) {
  const rows = [...subject.sexComparison].sort((a, b) => a.gradeOrder - b.gradeOrder);
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[360px] border-collapse text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 font-medium">Grado</th>
              <th className="px-3 py-2 text-center font-medium">% Mujeres</th>
              <th className="px-3 py-2 text-center font-medium">% Hombres</th>
              <th className="px-3 py-2 text-center font-medium">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.gradeId} className="border-b last:border-0">
                <td className="px-3 py-2 font-medium">{r.gradeName}</td>
                <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">
                  {fmtPct(r.femaleAvg, 0)}
                </td>
                <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">
                  {fmtPct(r.maleAvg, 0)}
                </td>
                <td className="px-3 py-2 text-center font-semibold" title={SEX_TITLE[r.result]}>
                  {SEX_SYMBOL[r.result] || '·'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        +M: mujeres significativamente mayor · +H: hombres significativamente mayor · ·: sin
        diferencia significativa · *: muestra insuficiente.
      </p>
    </div>
  );
}

function CountsTable({ subject }: { subject: EstablishmentSubjectSection }) {
  const rows = [...subject.counts].sort((a, b) => a.gradeOrder - b.gradeOrder);
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[420px] border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 font-medium">Grado</th>
            <th className="px-3 py-2 text-center font-medium">Mujeres</th>
            <th className="px-3 py-2 text-center font-medium">Hombres</th>
            <th className="px-3 py-2 text-center font-medium">Otro</th>
            <th className="px-3 py-2 text-center font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.gradeId} className="border-b last:border-0">
              <td className="px-3 py-2 font-medium">{r.gradeName}</td>
              <td className="px-3 py-2 text-center tabular-nums">{r.female}</td>
              <td className="px-3 py-2 text-center tabular-nums">{r.male}</td>
              <td className="px-3 py-2 text-center tabular-nums">{r.other}</td>
              <td className="px-3 py-2 text-center font-semibold tabular-nums">{r.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GradeHeader({
  grades,
  firstCol,
}: {
  grades: EstablishmentGradeColumn[];
  firstCol: string;
}) {
  return (
    <tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
      <th className="px-3 py-2 font-medium">{firstCol}</th>
      {grades.map((g) => (
        <th key={g.gradeId} className="px-3 py-2 text-center font-medium">
          {g.gradeName}
        </th>
      ))}
    </tr>
  );
}
