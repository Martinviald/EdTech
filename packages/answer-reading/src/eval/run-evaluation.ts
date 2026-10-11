import type { ConsensusPolicy, ReaderSpec } from '@soe/types';
import type { TranscriptionImage } from '../transcriber';
import {
  prepareSample,
  runEvalRepetition,
  sampleResult,
  skipReasonFor,
  skippedSampleResult,
  type EvalRepetitionResult,
  type EvalSampleResult,
  type EvalTranscriber,
  type PreparedSample,
} from './run-sample';
import type { EvalSample } from './manifest';

export interface EvalSampleInput {
  readonly sample: EvalSample;
  /** `null` si la imagen no se pudo leer (la muestra queda como `image_error`). */
  readonly image: TranscriptionImage | null;
  readonly imageError?: string;
}

export interface EvalBudget {
  readonly limitUsd: number;
  /** Costo estimado de una llamada del lector, dado lo observado hasta ahora. */
  estimateCallUsd(reader: ReaderSpec, observedUsd: readonly number[]): number;
}

export interface RunEvaluationOptions {
  readonly samples: readonly EvalSampleInput[];
  readonly readers: readonly ReaderSpec[];
  readonly policy: ConsensusPolicy;
  readonly repetitions: number;
  readonly concurrency: number;
  readonly transcriberFor: (reader: ReaderSpec) => EvalTranscriber | null;
  readonly budget?: EvalBudget;
  readonly onUnitDone?: (progress: { done: number; total: number; spentUsd: number }) => void;
}

export interface RunEvaluationResult {
  readonly samples: EvalSampleResult[];
  readonly spentUsd: number;
  readonly stoppedByBudget: boolean;
  readonly unitsPlanned: number;
  readonly unitsRun: number;
}

interface Unit {
  readonly index: number;
  readonly prepared: PreparedSample;
  readonly image: TranscriptionImage;
  readonly repetition: number;
}

class BudgetGate {
  private spent = 0;
  private reserved = 0;
  private exhausted = false;
  private readonly observed = new Map<string, number[]>();

  constructor(
    private readonly budget: EvalBudget | undefined,
    private readonly readers: readonly ReaderSpec[],
    private readonly policy: ConsensusPolicy,
  ) {}

  get spentUsd(): number {
    return this.spent;
  }

  get stopped(): boolean {
    return this.exhausted;
  }

  reserve(): number | null {
    if (this.exhausted) return null;
    const budget = this.budget;
    if (!budget) return 0;
    const callers = this.policy.tiebreakReader
      ? [...this.readers, this.policy.tiebreakReader]
      : this.readers;
    const estimate = callers.reduce(
      (total, reader) =>
        total + budget.estimateCallUsd(reader, this.observed.get(reader.key) ?? []),
      0,
    );
    if (this.spent + this.reserved + estimate > budget.limitUsd) {
      this.exhausted = true;
      return null;
    }
    this.reserved += estimate;
    return estimate;
  }

  settle(estimate: number, result: EvalRepetitionResult): void {
    this.reserved -= estimate;
    for (const reading of result.readings) {
      const cost = reading.costUsd ?? 0;
      this.spent += cost;
      if (reading.costUsd !== null) {
        const list = this.observed.get(reading.readerKey) ?? [];
        list.push(reading.costUsd);
        this.observed.set(reading.readerKey, list);
      }
    }
  }
}

/**
 * Corre la ruta sobre el dataset: cada muestra × repetición es una unidad. Las
 * unidades se lanzan en orden con `concurrency` en vuelo; antes de lanzar una se
 * reserva su costo estimado y, si superaría el presupuesto, se detiene todo lo
 * que falta (las muestras sin ninguna repetición quedan `budget_exceeded`).
 */
export async function runEvaluation(options: RunEvaluationOptions): Promise<RunEvaluationResult> {
  const prepared = options.samples.map((input) => prepareSample(input.sample));
  const results: Array<EvalSampleResult | null> = prepared.map(() => null);
  const repetitionsBySample = prepared.map(() => [] as EvalRepetitionResult[]);
  const readerList = options.policy.tiebreakReader
    ? [...options.readers, options.policy.tiebreakReader]
    : options.readers;

  const units: Unit[] = [];
  options.samples.forEach((input, index) => {
    const entry = prepared[index]!;
    if (input.image === null) {
      results[index] = skippedSampleResult(entry, 'image_error', input.imageError ?? 'Sin imagen');
      return;
    }
    const skip = skipReasonFor(input.sample, readerList);
    if (skip) {
      results[index] = skippedSampleResult(entry, skip.reason, skip.detail);
      return;
    }
    for (let repetition = 1; repetition <= options.repetitions; repetition += 1) {
      units.push({ index, prepared: entry, image: input.image, repetition });
    }
  });

  const gate = new BudgetGate(options.budget, options.readers, options.policy);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < units.length) {
      const estimate = gate.reserve();
      if (estimate === null) return;
      const unit = units[next]!;
      next += 1;
      const result = await runEvalRepetition({
        prepared: unit.prepared,
        image: unit.image,
        readers: options.readers,
        policy: options.policy,
        repetition: unit.repetition,
        transcriberFor: options.transcriberFor,
      });
      gate.settle(estimate, result);
      repetitionsBySample[unit.index]!.push(result);
      done += 1;
      options.onUnitDone?.({ done, total: units.length, spentUsd: gate.spentUsd });
    }
  };
  const workers = Math.max(1, Math.min(options.concurrency, units.length || 1));
  await Promise.all(Array.from({ length: workers }, worker));

  const samples = prepared.map((entry, index) => {
    const existing = results[index];
    if (existing) return existing;
    const repetitions = repetitionsBySample[index]!.sort(
      (a, b) => a.decision.repetition - b.decision.repetition,
    );
    if (repetitions.length === 0) {
      return skippedSampleResult(
        entry,
        'budget_exceeded',
        'Se alcanzó el presupuesto antes de leerla',
      );
    }
    return sampleResult(entry, repetitions);
  });

  return {
    samples,
    spentUsd: gate.spentUsd,
    stoppedByBudget: gate.stopped,
    unitsPlanned: units.length,
    unitsRun: done,
  };
}
