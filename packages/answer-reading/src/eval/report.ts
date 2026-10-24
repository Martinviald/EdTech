import type { ConsensusPolicy, ReaderSpec } from '@soe/types';
import { computeEvalMetrics, type EvalMetrics, type RateMetric } from './metrics';
import type { EvalSampleResult } from './run-sample';

export const EVAL_REPORT_VERSION = 1;

export interface EvalReportMeta {
  readonly datasetName: string;
  readonly datasetVersion: string;
  readonly routeId: string;
  readonly routeVersion: number;
  readonly readers: readonly ReaderSpec[];
  readonly policy: ConsensusPolicy;
  readonly repetitions: number;
  readonly dryRun: boolean;
  readonly budgetUsd: number | null;
  readonly stoppedByBudget: boolean;
  readonly startedAt: string;
  readonly finishedAt: string;
}

export interface EvalReport {
  readonly reportVersion: typeof EVAL_REPORT_VERSION;
  readonly meta: EvalReportMeta;
  readonly metrics: EvalMetrics;
  readonly samples: readonly EvalSampleResult[];
}

export function buildEvalReport(
  meta: EvalReportMeta,
  samples: readonly EvalSampleResult[],
): EvalReport {
  return {
    reportVersion: EVAL_REPORT_VERSION,
    meta,
    metrics: computeEvalMetrics(samples),
    samples,
  };
}

export interface MetricDelta {
  readonly metric: string;
  readonly previous: number | null;
  readonly current: number | null;
  readonly delta: number | null;
}

export interface SampleChange {
  readonly id: string;
  readonly previous: string;
  readonly current: string;
}

export interface EvalComparison {
  readonly previous: { routeId: string; finishedAt: string; datasetVersion: string };
  readonly deltas: readonly MetricDelta[];
  readonly changedSamples: readonly SampleChange[];
  readonly onlyInPrevious: readonly string[];
  readonly onlyInCurrent: readonly string[];
}

function scalarMetrics(metrics: EvalMetrics): Array<[string, number | null]> {
  const rows: Array<[string, number | null]> = [
    ['Autoaceptación', metrics.autoAccepted.rate],
    ['Precisión de lo autoaceptado', metrics.autoAcceptedPrecision.rate],
    ['Revisión', metrics.review.rate],
    ['Sin leer', metrics.notRead.rate],
    ['Acuerdo entre lectores', metrics.agreement.rate],
    ['Exactitud cuando coinciden', metrics.correctWhenAgree.rate],
    ['Sobrecorrección', metrics.overcorrection.rate],
    ['Exactitud de la corrección', metrics.grading?.accuracy.rate ?? null],
    ['Costo por recorte (USD)', metrics.cost.perCropUsd],
    ['Costo total (USD)', metrics.cost.totalUsd],
    ['Latencia p50 (ms)', metrics.latencyMs.p50],
    ['Latencia p95 (ms)', metrics.latencyMs.p95],
  ];
  for (const reader of metrics.readers) {
    rows.push([`Exactitud ${reader.readerKey}`, reader.accuracy.rate]);
    rows.push([`Sobrecorrección ${reader.readerKey}`, reader.overcorrection.rate]);
  }
  return rows;
}

/** Resumen comparable de una muestra: lecturas por lector y decisión por repetición. */
export function sampleSignature(sample: EvalSampleResult): string {
  if (sample.skipped !== null) return `omitida:${sample.skipped}`;
  const readings = sample.readings
    .map(
      (reading) =>
        `${reading.readerKey}#${reading.repetition}=${reading.status === 'ok' ? `${reading.state}:${reading.literal}` : reading.status}`,
    )
    .sort();
  const decisions = sample.decisions.map(
    (decision) =>
      `#${decision.repetition} ${decision.outcome}${decision.canonical ? ` ${decision.canonical}` : ''}${decision.reasons.length > 0 ? ` [${decision.reasons.join(',')}]` : ''}`,
  );
  return `${decisions.join(' · ')} | ${readings.join(' ')}`;
}

export function compareEvalReports(previous: EvalReport, current: EvalReport): EvalComparison {
  const previousRows = new Map(scalarMetrics(previous.metrics));
  const deltas = scalarMetrics(current.metrics).map(([metric, value]) => {
    const before = previousRows.has(metric) ? (previousRows.get(metric) ?? null) : null;
    return {
      metric,
      previous: before,
      current: value,
      delta: before === null || value === null ? null : value - before,
    };
  });
  const previousById = new Map(previous.samples.map((sample) => [sample.id, sample]));
  const currentIds = new Set(current.samples.map((sample) => sample.id));
  const changedSamples: SampleChange[] = [];
  for (const sample of current.samples) {
    const before = previousById.get(sample.id);
    if (!before) continue;
    const previousSignature = sampleSignature(before);
    const currentSignature = sampleSignature(sample);
    if (previousSignature !== currentSignature) {
      changedSamples.push({
        id: sample.id,
        previous: previousSignature,
        current: currentSignature,
      });
    }
  }
  return {
    previous: {
      routeId: previous.meta.routeId,
      finishedAt: previous.meta.finishedAt,
      datasetVersion: previous.meta.datasetVersion,
    },
    deltas,
    changedSamples,
    onlyInPrevious: previous.samples.map((s) => s.id).filter((id) => !currentIds.has(id)),
    onlyInCurrent: current.samples.map((s) => s.id).filter((id) => !previousById.has(id)),
  };
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function pct(metric: RateMetric | null | undefined): string {
  if (!metric || metric.rate === null) return '—';
  return `${(metric.rate * 100).toFixed(1).replace('.', ',')} % (${metric.count}/${metric.total})`;
}

function usd(value: number | null): string {
  return value === null ? '—' : `US$${value.toFixed(5).replace('.', ',')}`;
}

function ms(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)} ms`;
}

function deltaText(row: MetricDelta): string {
  if (row.delta === null) return '—';
  const isMoney = row.metric.includes('USD');
  const isTime = row.metric.includes('(ms)');
  const value = isMoney
    ? row.delta.toFixed(5)
    : isTime
      ? Math.round(row.delta).toString()
      : `${(row.delta * 100).toFixed(1)} pp`;
  return `${row.delta > 0 ? '+' : ''}${value}`.replace('.', ',');
}

function valueText(metric: string, value: number | null): string {
  if (value === null) return '—';
  if (metric.includes('USD')) return usd(value);
  if (metric.includes('(ms)')) return ms(value);
  return `${(value * 100).toFixed(1).replace('.', ',')} %`;
}

/** Resumen legible en Markdown (español), con la comparación si se pidió. */
export function renderEvalMarkdown(report: EvalReport, comparison?: EvalComparison): string {
  const { meta, metrics } = report;
  const lines: string[] = [];
  lines.push(`# Evaluación de lectura — ${meta.datasetName} (v${meta.datasetVersion})`, '');
  lines.push(
    `- Ruta: \`${meta.routeId}\` v${meta.routeVersion}${meta.dryRun ? ' (simulación sin APIs)' : ''}`,
  );
  lines.push(
    `- Lectores: ${meta.readers.map((r) => `\`${r.key}\` (${r.model}, ${r.promptRef}, razonamiento ${r.params.reasoning})`).join(' · ')}`,
  );
  lines.push(
    `- Política: \`${meta.policy.id}\` v${meta.policy.version}; la auditoría muestral (${meta.policy.auditSampleRate}) se ignora para medir todo lo autoaceptable`,
  );
  lines.push(`- Repeticiones: ${meta.repetitions}; ${meta.startedAt} → ${meta.finishedAt}`);
  if (meta.budgetUsd !== null) {
    lines.push(
      `- Presupuesto: ${usd(meta.budgetUsd)}${meta.stoppedByBudget ? ' — **se detuvo por presupuesto**' : ''}`,
    );
  }
  const skipped = Object.entries(metrics.samples.skipped)
    .map(([reason, count]) => `${reason}: ${count}`)
    .join(', ');
  lines.push(
    `- Muestras: ${metrics.samples.evaluated}/${metrics.samples.total} evaluadas${skipped ? ` (omitidas — ${skipped})` : ''}; ${metrics.decisions} decisiones`,
    '',
  );

  lines.push('## Decisión (consenso)', '', '| Métrica | Valor |', '| --- | --- |');
  lines.push(
    `| **Precisión de lo autoaceptado** (meta ${(metrics.promotion.autoAcceptedPrecisionTarget * 100).toFixed(1).replace('.', ',')} %) | **${pct(metrics.autoAcceptedPrecision)}** |`,
  );
  lines.push(`| Tasa de autoaceptación | ${pct(metrics.autoAccepted)} |`);
  lines.push(`| Tasa de revisión | ${pct(metrics.review)} |`);
  lines.push(`| Sin leer | ${pct(metrics.notRead)} |`);
  lines.push(`| Propuesta correcta en revisión | ${pct(metrics.reviewProposalAccuracy)} |`);
  lines.push(`| Acuerdo entre lectores | ${pct(metrics.agreement)} |`);
  lines.push(`| Exactitud cuando coinciden | ${pct(metrics.correctWhenAgree)} |`);
  lines.push(`| Sobrecorrección (lecturas) | ${pct(metrics.overcorrection)} |`);
  if (metrics.grading) {
    lines.push(`| Exactitud de la corrección | ${pct(metrics.grading.accuracy)} |`);
    lines.push(
      `| Error de resultado entre autoaceptadas | ${pct(metrics.grading.autoAcceptedResultError)} |`,
    );
  }
  lines.push(`| Costo total | ${usd(metrics.cost.totalUsd)} |`);
  lines.push(
    `| Costo por recorte / por 1.000 | ${usd(metrics.cost.perCropUsd)} / ${usd(metrics.cost.per1000CropsUsd)} |`,
  );
  lines.push(
    `| Latencia p50 / p95 | ${ms(metrics.latencyMs.p50)} / ${ms(metrics.latencyMs.p95)} |`,
    '',
  );
  if (metrics.autoAcceptedErrors.length > 0) {
    lines.push(`Autoaceptadas incorrectas: ${metrics.autoAcceptedErrors.join(', ')}`, '');
  }

  const reasons = Object.entries(metrics.reviewByReason);
  if (reasons.length > 0) {
    lines.push('### Revisión por motivo', '', '| Motivo | Tasa |', '| --- | --- |');
    for (const [reason, metric] of reasons) lines.push(`| ${reason} | ${pct(metric)} |`);
    lines.push('');
  }

  const formats = Object.entries(metrics.byFormat);
  if (formats.length > 0) {
    lines.push(
      '### Por formato',
      '',
      '| Formato | Decisiones | Autoaceptación | Precisión autoaceptada |',
      '| --- | --- | --- | --- |',
    );
    for (const [kind, entry] of formats) {
      if (!entry) continue;
      lines.push(
        `| ${kind} | ${entry.decisions} | ${pct(entry.autoAccepted)} | ${pct(entry.autoAcceptedPrecision)} |`,
      );
    }
    lines.push('');
  }

  lines.push(
    '## Lectores',
    '',
    '| Lector | Exactitud | Por formato | Sobrecorrección | Fallas | Estabilidad | Costo | p50 / p95 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const reader of metrics.readers) {
    const byFormat = Object.entries(reader.accuracyByFormat)
      .map(([kind, metric]) => `${kind} ${pct(metric)}`)
      .join('<br>');
    const failures = Object.entries(reader.failuresByStatus)
      .map(([status, count]) => `${status}: ${count}`)
      .join(', ');
    lines.push(
      `| ${reader.readerKey}${reader.role === 'tiebreak' ? ' (desempate)' : ''} | ${pct(reader.accuracy)} | ${byFormat || '—'} | ${pct(reader.overcorrection)} | ${failures || '0'} | ${pct(reader.stability)} | ${usd(reader.costUsd)} | ${ms(reader.latencyMs.p50)} / ${ms(reader.latencyMs.p95)} |`,
    );
  }
  lines.push('');

  lines.push(
    '## Muestras',
    '',
    '| Muestra | Formato | Etiqueta | Lecturas | Decisión |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const sample of report.samples) {
    if (sample.skipped !== null) {
      lines.push(
        `| ${sample.id} | ${sample.format.kind} | \`${cell(sample.truth.literal)}\` | — | omitida (${sample.skipped}) |`,
      );
      continue;
    }
    const readings = sample.readings
      .map((reading) => {
        const mark =
          reading.transcriptionCorrect === true
            ? '✓'
            : reading.transcriptionCorrect === false
              ? '✗'
              : '!';
        const text =
          reading.status === 'ok'
            ? reading.state === 'answered'
              ? `\`${cell(reading.literal ?? '')}\``
              : reading.state
            : reading.status;
        return `${reading.readerKey}#${reading.repetition} ${text} ${mark}`;
      })
      .join('<br>');
    const decisions = sample.decisions
      .map(
        (decision) =>
          `#${decision.repetition} ${decision.outcome}${decision.reasons.length ? ` (${decision.reasons.join(', ')})` : ''} ${decision.decisionCorrect ? '✓' : '✗'}`,
      )
      .join('<br>');
    lines.push(
      `| ${sample.id} | ${sample.format.kind} | \`${cell(sample.truth.literal) || '(en blanco)'}\` | ${readings} | ${decisions} |`,
    );
  }
  lines.push('');

  if (comparison) {
    lines.push(
      `## Comparación con la corrida anterior (${comparison.previous.routeId}, ${comparison.previous.finishedAt})`,
      '',
      '| Métrica | Antes | Ahora | Δ |',
      '| --- | --- | --- | --- |',
    );
    for (const row of comparison.deltas) {
      lines.push(
        `| ${row.metric} | ${valueText(row.metric, row.previous)} | ${valueText(row.metric, row.current)} | ${deltaText(row)} |`,
      );
    }
    lines.push('');
    if (comparison.changedSamples.length === 0) {
      lines.push('Ninguna muestra cambió.', '');
    } else {
      lines.push(
        '### Muestras que cambiaron',
        '',
        '| Muestra | Antes | Ahora |',
        '| --- | --- | --- |',
      );
      for (const change of comparison.changedSamples) {
        lines.push(`| ${change.id} | ${cell(change.previous)} | ${cell(change.current)} |`);
      }
      lines.push('');
    }
    if (comparison.onlyInPrevious.length > 0 || comparison.onlyInCurrent.length > 0) {
      lines.push(
        `Solo antes: ${comparison.onlyInPrevious.join(', ') || '—'}. Solo ahora: ${comparison.onlyInCurrent.join(', ') || '—'}.`,
        '',
      );
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
