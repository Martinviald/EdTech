import { createHash } from 'node:crypto';
import { access, appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ChoiceAnswer,
  DecisionQuestions,
  DecisionState,
  DecisionUsage,
} from '@soe/decisions';
import { CALL_LEDGER_FILE, canonicalJson, type CacheMode } from './reading-cache';

export interface DecisionCacheKeyInput {
  readonly engine: string;
  readonly model: string;
  readonly state: DecisionState;
  readonly questions: DecisionQuestions;
  readonly imageSha256: string;
}

export function decisionCacheKey(input: DecisionCacheKeyInput): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        engine: input.engine,
        model: input.model,
        state: input.state,
        questions: input.questions,
        imageSha256: input.imageSha256,
      }),
      'utf8',
    )
    .digest('hex');
}

export interface CachedDecision {
  readonly key: string;
  readonly storedAt: string;
  readonly engine: string;
  readonly model: string;
  readonly status: 'ok' | 'error';
  readonly answer?: ChoiceAnswer<string>;
  readonly usage?: DecisionUsage;
  readonly costUsd?: number;
  readonly latencyMs: number;
  readonly imageSha256: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

export class DecisionCache {
  private hits = 0;
  private misses = 0;

  constructor(
    readonly dir: string | null,
    readonly mode: CacheMode,
  ) {}

  get stats(): { hits: number; misses: number } {
    return { hits: this.hits, misses: this.misses };
  }

  private pathFor(key: string): string {
    return join(this.dir ?? '', `${key}.json`);
  }

  async get(key: string): Promise<CachedDecision | null> {
    if (this.mode !== 'use' || this.dir === null) return null;
    try {
      await access(this.pathFor(key));
      const entry = JSON.parse(await readFile(this.pathFor(key), 'utf8')) as CachedDecision;
      if (entry.key !== key || entry.status !== 'ok' || !entry.answer) {
        this.misses += 1;
        return null;
      }
      this.hits += 1;
      return entry;
    } catch {
      this.misses += 1;
      return null;
    }
  }

  async put(entry: CachedDecision): Promise<void> {
    if (this.mode === 'off' || this.dir === null) return;
    await mkdir(this.dir, { recursive: true });
    await appendFile(join(this.dir, CALL_LEDGER_FILE), `${JSON.stringify(entry)}\n`, 'utf8');
    if (entry.status !== 'ok') return;
    const temporary = `${this.pathFor(entry.key)}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
    await rename(temporary, this.pathFor(entry.key));
  }
}

export interface HarnessDecisionRequest {
  readonly state: DecisionState;
  readonly questions: DecisionQuestions;
  readonly image: { readonly mimeType: string; readonly base64: string };
}

export interface HarnessDecisionResult {
  readonly answer: ChoiceAnswer<string> | null;
  readonly model: string;
  readonly usage: DecisionUsage | null;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly errorCode: string | null;
}

export interface HarnessDecider {
  readonly engine: string;
  readonly model: string;
  decide(request: HarnessDecisionRequest): Promise<HarnessDecisionResult>;
}
