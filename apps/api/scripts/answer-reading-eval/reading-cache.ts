import { createHash } from 'node:crypto';
import { access, appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { StructuredVisionResult } from '@soe/answer-reading';
import type { ReaderSpec, RenderedPrompt, TranscriptionOutput } from '@soe/types';

export const READING_CACHE_KEY_VERSION = 1;

export const CALL_LEDGER_FILE = 'llamadas.jsonl';

export type CacheMode = 'use' | 'refresh' | 'off';

export interface ReadingCacheKeyInput {
  readonly reader: Pick<ReaderSpec, 'provider' | 'model' | 'params'>;
  readonly prompt: Pick<RenderedPrompt, 'system' | 'user' | 'outputSchemaId'>;
  readonly outputJsonSchema: {
    readonly schema: unknown;
    readonly propertyOrder: readonly string[];
  };
  readonly imageSha256: string;
  readonly repetition: number;
}

export interface ReadingCacheKeyMaterial {
  readonly keyVersion: number;
  readonly provider: string;
  readonly model: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly system: string;
  readonly user: string;
  readonly outputSchemaId: string;
  readonly outputSchema: unknown;
  readonly propertyOrder: readonly string[];
  readonly imageSha256: string;
  readonly repetition: number;
}

export interface CachedReading<TOutput = TranscriptionOutput> {
  readonly key: string;
  readonly source: string;
  readonly storedAt: string;
  readonly promptRef: string;
  readonly promptHash: string;
  readonly material: Omit<ReadingCacheKeyMaterial, 'system' | 'user' | 'outputSchema'>;
  readonly result: StructuredVisionResult<TOutput>;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function readingCacheKeyMaterial(input: ReadingCacheKeyInput): ReadingCacheKeyMaterial {
  return {
    keyVersion: READING_CACHE_KEY_VERSION,
    provider: input.reader.provider,
    model: input.reader.model,
    params: { ...input.reader.params },
    system: input.prompt.system,
    user: input.prompt.user,
    outputSchemaId: input.prompt.outputSchemaId,
    outputSchema: input.outputJsonSchema.schema,
    propertyOrder: [...input.outputJsonSchema.propertyOrder],
    imageSha256: input.imageSha256,
    repetition: input.repetition,
  };
}

export function readingCacheKey(input: ReadingCacheKeyInput): string {
  return createHash('sha256')
    .update(canonicalJson(readingCacheKeyMaterial(input)), 'utf8')
    .digest('hex');
}

export class ReadingCache {
  private hits = 0;
  private misses = 0;
  private writes = 0;

  constructor(
    readonly dir: string | null,
    readonly mode: CacheMode,
  ) {}

  get stats(): { hits: number; misses: number; writes: number } {
    return { hits: this.hits, misses: this.misses, writes: this.writes };
  }

  private pathFor(key: string): string {
    return join(this.dir ?? '', key.slice(0, 2), `${key}.json`);
  }

  async has(key: string): Promise<boolean> {
    if (this.mode !== 'use' || this.dir === null) return false;
    try {
      await access(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  async get<TOutput = TranscriptionOutput>(key: string): Promise<CachedReading<TOutput> | null> {
    if (this.mode !== 'use' || this.dir === null) return null;
    try {
      const entry = JSON.parse(await readFile(this.pathFor(key), 'utf8')) as CachedReading<TOutput>;
      if (entry.key !== key || entry.result.status !== 'ok') {
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

  async put<TOutput>(entry: CachedReading<TOutput>): Promise<boolean> {
    if (this.mode === 'off' || this.dir === null) return false;
    await this.appendToLedger(entry);
    if (entry.result.status !== 'ok') return false;
    const path = this.pathFor(entry.key);
    await mkdir(join(this.dir, entry.key.slice(0, 2)), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
    await rename(temporary, path);
    this.writes += 1;
    return true;
  }

  private async appendToLedger<TOutput>(entry: CachedReading<TOutput>): Promise<void> {
    await mkdir(this.dir ?? '', { recursive: true });
    await appendFile(join(this.dir ?? '', CALL_LEDGER_FILE), `${JSON.stringify(entry)}\n`, 'utf8');
  }
}

export function cachedReadingEntry<TOutput>(
  key: string,
  input: ReadingCacheKeyInput,
  prompt: Pick<RenderedPrompt, 'ref' | 'hash'>,
  result: StructuredVisionResult<TOutput>,
  source: string,
): CachedReading<TOutput> {
  const full = readingCacheKeyMaterial(input);
  return {
    key,
    source,
    storedAt: new Date().toISOString(),
    promptRef: prompt.ref,
    promptHash: prompt.hash,
    material: {
      keyVersion: full.keyVersion,
      provider: full.provider,
      model: full.model,
      params: full.params,
      outputSchemaId: full.outputSchemaId,
      propertyOrder: full.propertyOrder,
      imageSha256: full.imageSha256,
      repetition: full.repetition,
    },
    result,
  };
}
