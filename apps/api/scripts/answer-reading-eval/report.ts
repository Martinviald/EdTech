import type { ReadingRoute } from '@soe/types';
import type {
  EvalMetricsV2,
  PairedComparison,
  ReaderMetrics,
  VerifiedCase,
  VerifierMetrics,
} from './metrics';
import type { ReaderMinConfidence } from './route-set';
import type { ReadingRecord, SampleRecord, UnitRecord } from './simulate';
import type { Proportion } from './statistics';

export const EVAL_REPORT_VERSION = 2;

export interface EvalReportMeta {
  readonly reportVersion: number;
  readonly datasetName: string;
  readonly datasetVersion: string;
  readonly routesFile: string;
  readonly routesDescription: string | null;
  readonly routes: ReadonlyArray<
    Pick<ReadingRoute, 'id' | 'version' | 'status' | 'level' | 'formatKind'> & {
      readonly readers: readonly string[];
      readonly minConfidence: number;
    }
  >;
  readonly readerMinConfidence: ReaderMinConfidence | null;
  readonly repetitions: number;
  readonly dryRun: boolean;
  readonly cacheDir: string | null;
  readonly cacheMode: string;
  readonly budgetUsd: number | null;
  readonly stoppedByBudget: boolean;
  readonly startedAt: string;
  readonly finishedAt: string;
}

export interface EvalReportV2 {
  readonly meta: EvalReportMeta;
  readonly metrics: EvalMetricsV2;
  readonly samples: readonly SampleRecord[];
  readonly units: readonly UnitRecord[];
  readonly readings: readonly ReadingRecord[];
}

function pct(value: number | null): string {
  return value === null ? '—' : `${(100 * value).toFixed(1).replace('.', ',')} %`;
}

function rate(metric: Proportion): string {
  if (metric.total === 0) return '—';
  const ci = metric.ci95 ? ` [${pct(metric.ci95[0])}–${pct(metric.ci95[1])}]` : '';
  return `${metric.count}/${metric.total} (${pct(metric.rate)})${ci}`;
}

function num(value: number | null, digits = 2): string {
  return value === null ? '—' : value.toFixed(digits).replace('.', ',');
}

function usd(value: number | null): string {
  return value === null ? '—' : `US$${value.toFixed(5).replace('.', ',')}`;
}

function ms(value: number | null): string {
  return value === null ? '—' : `${(value / 1000).toFixed(1).replace('.', ',')} s`;
}

function reasons(counts: Readonly<Record<string, number | undefined>>): string {
  const entries = Object.entries(counts)
    .filter((entry): entry is [string, number] => entry[1] !== undefined)
    .sort((a, b) => b[1] - a[1]);
  return entries.length === 0 ? '—' : entries.map(([reason, n]) => `${reason} ${n}`).join(', ');
}

function readerRows(readers: readonly ReaderMetrics[]): string[] {
  const rows = [
    '| Lector | Lectura exacta | Estabilidad (casillas) | Conf. media si acierta / si falla | Exactas con conf ≥ 0,85 | Exactas con conf ≥ 0,97 | Pide revisión si acierta / si falla | Desde caché | Costo por lectura | Latencia p50 / p95 |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const reader of readers) {
    const short = reader.short;
    if (!short) continue;
    rows.push(
      `| ${reader.readerKey}${reader.role === 'tiebreak' ? ' (desempate)' : ''} | ${rate(short.exact)} | ${rate(short.stability)} | ${num(short.meanConfidenceExact)} / ${num(short.meanConfidenceWrong)} | ${rate(short.exactAtConfidence['0.85']!)} | ${rate(short.exactAtConfidence['0.97']!)} | ${rate(short.reviewRequestedWhenExact)} / ${rate(short.reviewRequestedWhenWrong)} | ${reader.fromCache} | ${usd(reader.costPerReadingUsd)} | ${ms(reader.latencyMs.p50)} / ${ms(reader.latencyMs.p95)} |`,
    );
  }
  return rows;
}

function formatRows(readers: readonly ReaderMetrics[]): string[] {
  const shortReaders = readers.filter((reader) => reader.short !== null);
  const kinds = [
    ...new Set(shortReaders.flatMap((reader) => Object.keys(reader.short?.exactByFormat ?? {}))),
  ];
  if (kinds.length === 0) return [];
  const rows = [
    `| Formato | ${shortReaders.map((reader) => reader.readerKey).join(' | ')} |`,
    `|---|${shortReaders.map(() => '---').join('|')}|`,
  ];
  for (const kind of kinds) {
    const cells = shortReaders.map((reader) => {
      const metric = reader.short?.exactByFormat[kind as keyof typeof reader.short.exactByFormat];
      return metric ? `${metric.count}/${metric.total}` : '—';
    });
    rows.push(`| ${kind} | ${cells.join(' | ')} |`);
  }
  return rows;
}

function developmentRows(report: EvalReportV2): string[] {
  const readers = report.metrics.readers.filter((reader) => reader.development !== null);
  if (readers.length === 0) return ['Sin casillas de desarrollo evaluadas.'];
  const sampleIds = [
    ...new Set(
      readers.flatMap((reader) => Object.keys(reader.development?.fidelityBySample ?? {})),
    ),
  ];
  const rows = [
    '| Lector | Similitud media | Mínima | Fallas | Por recorte (media de las repeticiones) |',
    '|---|---|---|---|---|',
  ];
  for (const reader of readers) {
    const development = reader.development!;
    const perSample = sampleIds
      .map((id) => `${id} ${num(development.fidelityBySample[id] ?? null)}`)
      .join(' · ');
    rows.push(
      `| ${reader.readerKey} | ${num(development.fidelityMean)} | ${num(development.fidelityMin)} | ${development.failed} | ${perSample} |`,
    );
  }
  return rows;
}

function sampleRows(report: EvalReportV2): string[] {
  const unitsBySample = new Map<string, UnitRecord[]>();
  for (const unit of report.units) {
    const list = unitsBySample.get(unit.sampleId);
    if (list) list.push(unit);
    else unitsBySample.set(unit.sampleId, [unit]);
  }
  const readingsBySample = new Map<string, ReadingRecord[]>();
  for (const reading of report.readings) {
    const list = readingsBySample.get(reading.sampleId);
    if (list) list.push(reading);
    else readingsBySample.set(reading.sampleId, [reading]);
  }
  const rows = [
    '| Muestra | Formato | Verdad | Lecturas (lector: canónico/conf. por repetición) | Decisiones |',
    '|---|---|---|---|---|',
  ];
  for (const sample of report.samples) {
    if (sample.skipped) {
      rows.push(
        `| ${sample.id} | ${sample.formatKind} | \`${sample.truth.canonical ?? sample.truth.literal}\` | omitida (${sample.skipped}) | — |`,
      );
      continue;
    }
    const byReader = new Map<string, string[]>();
    for (const reading of readingsBySample.get(sample.id) ?? []) {
      const mark = reading.exact === true ? '✓' : reading.exact === false ? '✗' : '·';
      const value =
        reading.status !== 'ok'
          ? `!${reading.status}`
          : `${mark}${reading.exact === false ? `\`${reading.canonical ?? reading.literal ?? ''}\`` : ''}/${num(reading.confidence)}${reading.reviewRequested ? 'R' : ''}`;
      const list = byReader.get(reading.readerKey) ?? [];
      list.push(value);
      byReader.set(reading.readerKey, list);
    }
    const readings = [...byReader.entries()]
      .map(([reader, values]) => `${reader}: ${values.join(' ')}`)
      .join('<br>');
    const decisions = (unitsBySample.get(sample.id) ?? [])
      .map((unit) =>
        unit.autoAccepted
          ? `auto${unit.autoAcceptedError ? `✗(${unit.autoAcceptedError})` : '✓'}`
          : `rev: ${unit.reasons.join(',')}`,
      )
      .join('<br>');
    rows.push(
      `| ${sample.id} | ${sample.formatKind} | \`${sample.group === 'development' ? sample.truth.literal.slice(0, 40) : (sample.truth.canonical ?? '')}\` | ${readings} | ${decisions} |`,
    );
  }
  return rows;
}

function comparisonSection(comparison: PairedComparison): string[] {
  const lines = [
    '## Comparación pareada',
    '',
    `Unidades pareadas (muestra × repetición, solo respuesta corta): ${comparison.pairedUnits}. Solo en la anterior: ${comparison.onlyBefore}; solo en esta: ${comparison.onlyAfter}. McNemar exacto bilateral sobre los pares discordantes; las repeticiones de una misma casilla no son independientes, así que el valor p es optimista.`,
    '',
    '| Métrica | Anterior | Esta corrida | Ambas | Ninguna | Solo anterior | Solo esta | p (McNemar) |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const metric of comparison.metrics) {
    lines.push(
      `| ${metric.metric} | ${rate(metric.before)} | ${rate(metric.after)} | ${metric.both} | ${metric.neither} | ${metric.mcnemar.onlyBefore} | ${metric.mcnemar.onlyAfter} | ${num(metric.mcnemar.pValue, 3)} |`,
    );
  }
  lines.push('', '### Unidades que cambiaron', '');
  if (comparison.changedUnits.length === 0) {
    lines.push('Ninguna.');
    return lines;
  }
  lines.push('| Muestra | Rep. | Antes | Ahora |', '|---|---|---|---|');
  const describe = (decision: ChangedSide) =>
    `${decision.outcome}${decision.autoAcceptedError ? ` ✗(${decision.autoAcceptedError})` : ''} \`${decision.canonical ?? '—'}\`${decision.reasons.length > 0 ? ` (${decision.reasons.join(', ')})` : ''}`;
  for (const unit of comparison.changedUnits) {
    lines.push(
      `| ${unit.sampleId} | ${unit.repetition} | ${describe(unit.before)} | ${describe(unit.after)} |`,
    );
  }
  return lines;
}

type ChangedSide = PairedComparison['changedUnits'][number]['before'];

const VERIFIED_CASE_LABELS: Readonly<Record<VerifiedCase['kind'], string>> = {
  unfair_zero: '0 injusto',
  true_incorrect: 'incorrecta verdadera',
  other_error: 'otra lectura equivocada',
};

function verifierSection(verifier: VerifierMetrics): string[] {
  const lines = [
    '## Verificador de incorrectas',
    '',
    `Verificador: ${verifier.readerKeys.map((key) => `\`${key}\``).join(', ')}. Solo puede mandar a revisión (\`verifier_flagged\` si duda, \`verifier_failed\` si no pudo revisar): nunca acepta ni cambia una nota.`,
    '',
    '| Métrica | Valor [IC 95 % de Wilson] |',
    '|---|---|',
    `| Incorrectas autoaceptadas antes → después | ${verifier.autoAcceptedIncorrect.before} → ${verifier.autoAcceptedIncorrect.after} |`,
    `| Marcadas por el verificador | ${rate(verifier.flagged)} |`,
    `| **0 injustos atrapados** | ${rate(verifier.unfairZeros.caught)} |`,
    `| Falsos avisos (incorrectas verdaderas a revisión) | ${rate(verifier.falseAlarms)} |`,
    `| Otras lecturas equivocadas marcadas | ${verifier.otherErrors.flagged}/${verifier.otherErrors.before} |`,
    `| Autoaceptadas que perjudican al alumno antes → después | ${verifier.harmsStudent.before} → ${verifier.harmsStudent.after} |`,
    `| Llamadas / desde el caché / fallidas | ${verifier.called} / ${verifier.fromCache} / ${verifier.failed} |`,
    `| Costo extra total / por recorte corto | ${usd(verifier.extraCostUsd)} / ${usd(verifier.extraCostPerShortCropUsd)} |`,
    '',
    '| Muestra | Rep. | Aceptada | Verdad | Caso | Veredicto | Marcada |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const entry of verifier.cases) {
    const verdict =
      entry.status !== 'ok'
        ? `falla (${entry.status ?? 'sin llamada'})`
        : `${entry.couldBeKey ? 'podría ser la clave' : 'no'} ${num(entry.confidence)}`;
    lines.push(
      `| ${entry.sampleId} | ${entry.repetition} | \`${entry.accepted}\` | \`${entry.truth}\` | ${VERIFIED_CASE_LABELS[entry.kind]} | ${verdict} | ${entry.flagged ? 'sí' : 'no'} |`,
    );
  }
  return lines;
}

export function renderReportMarkdown(
  report: EvalReportV2,
  comparison: PairedComparison | null,
): string {
  const { meta, metrics } = report;
  const short = metrics.short;
  const thresholds = meta.readerMinConfidence
    ? Object.entries(meta.readerMinConfidence)
        .map(([key, value]) => `${key} ≥ ${num(value)}`)
        .join(', ')
    : null;
  const lines = [
    `# Evaluación de lectura por visión — ${meta.datasetName} v${meta.datasetVersion}`,
    '',
    `Rutas: \`${meta.routesFile}\`${meta.routesDescription ? ` — ${meta.routesDescription}` : ''}`,
    '',
    `Repeticiones: ${meta.repetitions}. Caché: ${meta.cacheMode}${meta.cacheDir ? ` (\`${meta.cacheDir}\`)` : ''}. ${meta.dryRun ? 'Simulación sin APIs (--dry-run). ' : ''}Corrida: ${meta.startedAt} → ${meta.finishedAt}.`,
    '',
  ];
  if (thresholds) {
    lines.push(
      `**Umbral por lector (override):** ${thresholds}. Reemplaza al umbral que cada lector nombrado trae en la ruta. La política se evalúa con \`minConfidence\` 0 y, si alguna lectura principal queda bajo el umbral de su lector (o bajo el \`minConfidence\` de la ruta si el lector no tiene umbral propio), la casilla va a revisión por \`low_confidence\`.`,
      '',
    );
  }
  if (meta.stoppedByBudget) {
    lines.push(
      `**⚠ La corrida alcanzó el tope de US$${meta.budgetUsd}: hay lecturas con \`budget_exceeded\` y las cifras no son válidas.**`,
      '',
    );
  }
  lines.push(
    '## Respuesta corta (corrección con clave)',
    '',
    '| Métrica | Valor [IC 95 % de Wilson] |',
    '|---|---|',
    `| Unidades (casilla × repetición) | ${short.units} |`,
    `| Autoaceptadas | ${rate(short.autoAccepted)} |`,
    `| Autoaceptadas correctas | ${short.autoAcceptedCorrect} |`,
    `| Autoaceptadas equivocadas (sobre autoaceptadas) | ${rate(short.autoAcceptedWrong)} |`,
    `| — perjudican al alumno | ${short.harmsStudent.count} (efecto ${num(short.harmsStudent.points)} puntos) |`,
    `| — lo favorecen | ${short.favorsStudent.count} (efecto +${num(short.favorsStudent.points)} puntos) |`,
    `| — sin efecto en el puntaje | ${short.wrongWithoutScoreEffect} |`,
    `| A revisión | ${rate(short.review)} |`,
    `| Revisión por motivo | ${reasons(short.reviewByReason)} |`,
    `| Sin leer | ${short.notRead} |`,
    `| Revisión forzada por umbral de lector | ${short.readerThresholdApplied} |`,
    '',
    'Autoaceptadas equivocadas:',
    '',
  );
  if (short.errors.length === 0) lines.push('- ninguna');
  for (const error of short.errors) {
    lines.push(
      `- ${error.sampleId} rep ${error.repetition}: aceptó \`${error.accepted}\` (verdad \`${error.truth}\`), ${error.kind === 'harms' ? '**perjudica al alumno**' : error.kind === 'favors' ? '**lo favorece**' : 'sin efecto en el puntaje'} (${num(error.pointsDelta)} puntos)`,
    );
  }
  lines.push(
    '',
    '### Por formato',
    '',
    '| Formato | Unidades | Autoaceptadas | Equivocadas |',
    '|---|---|---|---|',
  );
  for (const [kind, value] of Object.entries(short.byFormat)) {
    if (!value) continue;
    lines.push(`| ${kind} | ${value.units} | ${rate(value.autoAccepted)} | ${value.wrong} |`);
  }
  lines.push(
    '',
    '### Lectores',
    '',
    'Lectura exacta: la clave canónica de la lectura es igual a la de la verdad, con la misma normalización de producción. Estabilidad: casillas con la misma lectura en todas las repeticiones.',
    '',
    ...readerRows(metrics.readers),
    '',
    'Lecturas exactas por formato:',
    '',
    ...formatRows(metrics.readers),
    '',
    '## Desarrollo (fidelidad de la transcripción, no nota)',
    '',
    `Unidades: ${metrics.development.units}; autoaceptadas: ${metrics.development.autoAccepted}; revisión por motivo: ${reasons(metrics.development.reviewByReason)}. Similitud = 1 − Levenshtein / largo, tras minúsculas, sin tildes y con \`×\`→\`x\`, \`⇒\`→\`=>\`.`,
    '',
    ...developmentRows(report),
    '',
    '## Costo y latencia',
    '',
    '| Métrica | Valor |',
    '|---|---|',
    `| Costo nominal por recorte (todas / corta / desarrollo) | ${usd(metrics.cost.nominalPerCropUsd)} / ${usd(metrics.cost.nominalPerShortCropUsd)} / ${usd(metrics.cost.nominalPerDevelopmentCropUsd)} |`,
    `| Costo nominal total (incluye lo leído del caché) | ${usd(metrics.cost.nominalTotalUsd)} |`,
    `| **Gasto real de esta corrida** | ${usd(metrics.cost.spentUsd)} en ${metrics.cost.apiCalls} llamadas |`,
    `| Lecturas desde el caché | ${metrics.cost.readingsFromCache}/${metrics.cost.readingsTotal} |`,
    `| Latencia por lectura p50 / p95 | ${ms(metrics.latencyMs.perReading.p50)} / ${ms(metrics.latencyMs.perReading.p95)} |`,
    `| Latencia por recorte p50 / p95 (lectores en paralelo) | ${ms(metrics.latencyMs.perCrop.p50)} / ${ms(metrics.latencyMs.perCrop.p95)} |`,
    '',
    'El costo y la latencia de una lectura del caché son los de la llamada original.',
    '',
  );
  if (metrics.verifier) lines.push(...verifierSection(metrics.verifier), '');
  if (comparison) lines.push(...comparisonSection(comparison), '');
  lines.push(
    '## Detalle por muestra',
    '',
    '✓ exacta · ✗ distinta de la verdad · ! falla; el número es la confianza; R = pidió revisión.',
    '',
    ...sampleRows(report),
    '',
  );
  return lines.join('\n');
}
