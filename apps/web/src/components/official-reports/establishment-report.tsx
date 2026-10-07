import Link from 'next/link';
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
import { ROUTES } from '@/lib/routes';
import { AlertCallout } from '@/components/shared/AlertCallout';
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
import { bandBadgeClass } from './band-levels';

// ─────────────────────────────────────────────────────────────────────────────
// TKT-25 — Informe de establecimiento (Área Académica) de UN proceso de medición.
// Server Component. Reproduce las Tablas 1.1–1.9 por asignatura. Cada columna de
// grado sale de una sola evaluación del proceso: si el grado tiene más de una, la
// columna va sin números y lo advierte. Los niveles son SIEMPRE las bandas del
// instrumento de la columna; una columna sin bandas lo dice ("Sin niveles
// definidos") en vez de caer a cortes heredados.
// ─────────────────────────────────────────────────────────────────────────────

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

const MULTIPLE_ASSESSMENTS_LABEL = 'Más de una evaluación';
const BANDS_MISSING_LABEL = 'Sin niveles definidos';

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
    { label: 'Proceso de medición', value: meta.processName },
    { label: 'Año académico', value: meta.academicYear ? String(meta.academicYear) : '—' },
    { label: 'Momento', value: meta.periodLabel ?? meta.period ?? '—' },
    { label: 'Generado', value: fmtDateTime(meta.generatedAt) },
  ];

  return (
    <ReportShell>
      <ReportCover
        eyebrow="Informe de resultados — Establecimiento"
        title={meta.processName}
        subtitle={[
          meta.orgName,
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
          Este proceso todavía no tiene evaluaciones con asignatura asociada.
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
  const multipleColumns = subject.grades.filter((g) => g.multipleAssessments);
  return (
    <ReportSection title={subject.subjectName}>
      <CoverageLine grades={subject.grades} />

      {multipleColumns.length > 0 ? <MultipleAssessmentsNotice grades={multipleColumns} /> : null}

      <div className="space-y-2">
        <p className="text-sm font-medium">
          Tabla 1.{tableIndex} — Estudiantes por nivel de logro (%)
        </p>
        {subject.bands && subject.bands.length > 0 ? (
          <BandDistributionTable
            grades={subject.grades}
            bands={subject.bands}
            cells={subject.bandDistribution}
            samples={samples}
          />
        ) : (
          <PerColumnBandTables
            grades={subject.grades}
            cells={subject.bandDistribution}
            samples={samples}
          />
        )}
      </div>

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

      <div className="space-y-2">
        <p className="text-sm font-medium">Tabla 1.9 — Cantidad de estudiantes evaluados</p>
        {subject.counts.length > 0 ? (
          <CountsTable subject={subject} />
        ) : (
          <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            Ningún grado de esta asignatura tiene una sola evaluación en el proceso.
          </p>
        )}
      </div>
    </ReportSection>
  );
}

function CoverageLine({ grades }: { grades: EstablishmentGradeColumn[] }) {
  return (
    <p className="text-sm text-muted-foreground">
      <span className="font-medium text-foreground">Cobertura (evaluados / esperados): </span>
      {grades.map((g, i) => (
        <span key={g.gradeId} className="whitespace-nowrap">
          {i > 0 ? ' · ' : null}
          {g.gradeName} {g.coverage.evaluated} / {g.coverage.expected ?? '—'}
        </span>
      ))}
    </p>
  );
}

function MultipleAssessmentsNotice({ grades }: { grades: EstablishmentGradeColumn[] }) {
  return (
    <AlertCallout tone="warning" title="Hay más de una evaluación de este grado en el proceso">
      <p className="text-sm">
        Esos grados se muestran sin números para no mezclar resultados de evaluaciones distintas.
        Deja una sola evaluación por grado y asignatura en el proceso para verlos.
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {grades.map((g) => (
          <li key={g.gradeId}>
            <span className="font-medium">{g.gradeName}:</span>{' '}
            {g.assessments.map((a, i) => (
              <span key={a.id}>
                {i > 0 ? ', ' : null}
                <Link href={ROUTES.evaluacion(a.id)} className="underline underline-offset-2">
                  {a.name ?? 'Evaluación sin nombre'}
                </Link>
              </span>
            ))}
          </li>
        ))}
      </ul>
    </AlertCallout>
  );
}

function columnStatusLabel(grade: EstablishmentGradeColumn): string | null {
  if (grade.multipleAssessments) return MULTIPLE_ASSESSMENTS_LABEL;
  if (grade.bandsMissing) return BANDS_MISSING_LABEL;
  return null;
}

function sampleSharesFor(
  grade: EstablishmentGradeColumn,
  bands: PerformanceBandView[],
  samples: EstablishmentSamples | null | undefined,
): Map<string, number> | null {
  if (!samples || !grade.instrumentId) return null;
  const bandCounts = samples.get(grade.instrumentId)?.global?.bandCounts;
  if (!bandCounts || bandCounts.length === 0) return null;
  const total = bandCounts.reduce((acc, band) => acc + band.count, 0);
  if (total === 0) return null;
  const shares = new Map(bandCounts.map((band) => [band.bandKey, (band.count / total) * 100]));
  return bands.every((band) => shares.has(band.key)) ? shares : null;
}

function BandBadge({ band, bands }: { band: PerformanceBandView; bands: PerformanceBandView[] }) {
  const orders = bands.map((b) => b.order);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold',
        bandBadgeClass(band.order, orders),
      )}
    >
      {band.label}
    </span>
  );
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
  const orderedBands = [...bands].sort((a, b) => a.order - b.order);
  const sharesByGrade = new Map(
    grades.map((g) => [g.gradeId, g.bands ? sampleSharesFor(g, orderedBands, samples) : null]),
  );

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
                <BandBadge band={band} bands={orderedBands} />
              </th>
              {grades.map((g) => {
                const cell = byCell.get(`${g.gradeId}|${band.key}`);
                const sampleShare = sharesByGrade.get(g.gradeId)?.get(band.key);
                return (
                  <td key={g.gradeId} className="px-3 py-2 text-center tabular-nums">
                    {cell ? fmtPct(cell.percentage, 0) : '—'}
                    {sampleShare === undefined ? null : (
                      <span className="block text-xs text-muted-foreground print:hidden">
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

function PerColumnBandTables({
  grades,
  cells,
  samples,
}: {
  grades: EstablishmentGradeColumn[];
  cells: EstablishmentBandCell[];
  samples?: EstablishmentSamples | null;
}) {
  const byCell = new Map(cells.map((c) => [`${c.gradeId}|${c.bandKey}`, c]));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {grades.map((g) => {
        const status = columnStatusLabel(g);
        const bands = g.bands ? [...g.bands].sort((a, b) => a.order - b.order) : null;
        const shares = bands ? sampleSharesFor(g, bands, samples) : null;
        return (
          <div key={g.gradeId} className="rounded-md border">
            <p className="border-b bg-muted/50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {g.gradeName}
            </p>
            {bands && !status ? (
              <table className="w-full border-collapse text-sm">
                <tbody>
                  {bands.map((band) => {
                    const cell = byCell.get(`${g.gradeId}|${band.key}`);
                    const sampleShare = shares?.get(band.key);
                    return (
                      <tr key={band.key} className="border-b last:border-0">
                        <th className="whitespace-nowrap px-3 py-2 text-left font-medium">
                          <BandBadge band={band} bands={bands} />
                        </th>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {cell ? fmtPct(cell.percentage, 0) : '—'}
                          {sampleShare === undefined ? null : (
                            <span className="block text-xs text-muted-foreground print:hidden">
                              Muestra {fmtPct(sampleShare, 0)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                {status ?? BANDS_MISSING_LABEL}
              </p>
            )}
          </div>
        );
      })}
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
      {grades.map((g) => {
        const status = columnStatusLabel(g);
        return (
          <th key={g.gradeId} className="px-3 py-2 text-center font-medium">
            {g.gradeName}
            {status ? (
              <span className="block text-2xs font-normal normal-case tracking-normal">
                {status}
              </span>
            ) : null}
          </th>
        );
      })}
    </tr>
  );
}
