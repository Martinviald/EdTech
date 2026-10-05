import type {
  InstrumentSampleEntry,
  OfficialEstablishmentReportResponse,
  EstablishmentSubjectSection,
  EstablishmentGradeColumn,
  EstablishmentBandCell,
  PerformanceBandView,
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
import { DIA_LEVEL_ORDER, DIA_LEVEL_OF, DIA_LEVEL_LABELS, diaLevelBadgeClass } from './dia-levels';
import { bandBadgeClass } from './band-levels';

// ─────────────────────────────────────────────────────────────────────────────
// TKT-25 — Informe de establecimiento (Área Académica). Server Component.
// Reproduce las Tablas 1.1–1.9: una por asignatura con niveles de logro I/II/III
// por grado, comparación por sexo, y conteos. Si la asignatura trae las bandas de
// sus instrumentos (`bands`/`bandDistribution`), las filas son esas bandas — la
// misma clasificación del informe por evaluación. Si no, el colapso de los 4
// niveles de la plataforma a I/II/III lo aplica el frontend (ver `dia-levels.ts`).
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

export type EstablishmentSamples = ReadonlyMap<string, InstrumentSampleEntry>;

export function EstablishmentReport({
  report,
  samples,
}: {
  report: OfficialEstablishmentReportResponse;
  /** Muestra de benchmarking por instrumento; sólo llega para roles directivos. */
  samples?: EstablishmentSamples | null;
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
        subtitle={[
          meta.periodLabel ?? meta.period,
          meta.academicYear ? String(meta.academicYear) : null,
        ]
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
            samples={samples}
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
  samples,
}: {
  subject: EstablishmentSubjectSection;
  tableIndex: number;
  sexDataAvailable: boolean;
  samples?: EstablishmentSamples | null;
}) {
  return (
    <ReportSection title={subject.subjectName}>
      {/* Tabla 1.x — niveles de logro por grado */}
      <div className="space-y-2">
        <p className="text-sm font-medium">
          Tabla 1.{tableIndex} — Estudiantes por nivel de logro (%)
        </p>
        <LevelDistributionTable subject={subject} samples={samples} />
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

function LevelDistributionTable({
  subject,
  samples,
}: {
  subject: EstablishmentSubjectSection;
  samples?: EstablishmentSamples | null;
}) {
  if (subject.bands && subject.bands.length > 0 && subject.bandDistribution) {
    return (
      <BandDistributionTable
        grades={subject.grades}
        bands={subject.bands}
        cells={subject.bandDistribution}
        samples={samples}
      />
    );
  }
  return <LegacyLevelDistributionTable subject={subject} />;
}

/** % de la muestra por banda para cada grado con un solo instrumento y la misma escala. */
function sampleSharesByGrade(
  grades: EstablishmentGradeColumn[],
  bands: PerformanceBandView[],
  samples: EstablishmentSamples | null | undefined,
): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  if (!samples) return result;
  for (const grade of grades) {
    const bandCounts = grade.instrumentId
      ? samples.get(grade.instrumentId)?.global?.bandCounts
      : null;
    if (!bandCounts || bandCounts.length === 0) continue;
    const total = bandCounts.reduce((acc, band) => acc + band.count, 0);
    const shares = new Map(bandCounts.map((band) => [band.bandKey, (band.count / total) * 100]));
    if (total > 0 && bands.every((band) => shares.has(band.key))) result.set(grade.gradeId, shares);
  }
  return result;
}

function BandDistributionTable({
  grades,
  bands,
  cells,
  samples,
}: {
  grades: EstablishmentGradeColumn[];
  bands: PerformanceBandView[];
  cells: EstablishmentBandCell[];
  samples?: EstablishmentSamples | null;
}) {
  const byCell = new Map(cells.map((c) => [`${c.gradeId}|${c.bandKey}`, c]));
  const sampleShares = sampleSharesByGrade(grades, bands, samples);
  const orderedBands = [...bands].sort((a, b) => a.order - b.order);
  const orders = orderedBands.map((b) => b.order);

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[480px] border-collapse text-sm">
        <thead>
          <GradeHeader grades={grades} firstCol="Nivel" />
        </thead>
        <tbody>
          {orderedBands.map((band) => (
            <tr key={band.key} className="border-b last:border-0">
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">
                <span
                  className={cn(
                    'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold',
                    bandBadgeClass(band.order, orders),
                  )}
                >
                  {band.label}
                </span>
              </th>
              {grades.map((g) => {
                const cell = byCell.get(`${g.gradeId}|${band.key}`);
                const sampleShare = sampleShares.get(g.gradeId)?.get(band.key);
                return (
                  <td key={g.gradeId} className="px-3 py-2 text-center tabular-nums">
                    {cell ? fmtPct(cell.percentage, 0) : '—'}
                    {sampleShare === undefined ? null : (
                      <span className="block text-xs text-muted-foreground">
                        Muestra {fmtPct(sampleShare, 0)}
                      </span>
                    )}
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

function LegacyLevelDistributionTable({ subject }: { subject: EstablishmentSubjectSection }) {
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
