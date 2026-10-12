import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TranscriptionJsonSchema, TranscriptionResult } from '@soe/answer-reading';
import type { ReaderSpec, RenderedPrompt } from '@soe/types';

export const READING_CACHE_KEY_VERSION = 1;

export type CacheMode = 'use' | 'refresh' | 'off';

export interface ReadingCacheKeyInput {
  readonly reader: Pick<ReaderSpec, 'provider' | 'model' | 'params'>;
  readonly prompt: Pick<RenderedPrompt, 'system' | 'user' | 'outputSchemaId'>;
  readonly outputJsonSchema: TranscriptionJsonSchema;
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

export interface CachedReading {
  readonly key: string;
  readonly source: string;
  readonly storedAt: string;
  readonly promptRef: string;
  readonly promptHash: string;
  readonly material: Omit<ReadingCacheKeyMaterial, 'system' | 'user' | 'outputSchema'>;
  readonly result: TranscriptionResult;
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

  async get(key: string): Promise<CachedReading | null> {
    if (this.mode !== 'use' || this.dir === null) return null;
    try {
      const entry = JSON.parse(await readFile(this.pathFor(key), 'utf8')) as CachedReading;
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

  async put(entry: CachedReading): Promise<boolean> {
    if (this.mode === 'off' || this.dir === null || entry.result.status !== 'ok') return false;
    const path = this.pathFor(entry.key);
    await mkdir(join(this.dir, entry.key.slice(0, 2)), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
    await rename(temporary, path);
    this.writes += 1;
    return true;
  }
}

export function cachedReadingEntry(
  key: string,
  input: ReadingCacheKeyInput,
  prompt: Pick<RenderedPrompt, 'ref' | 'hash'>,
  result: TranscriptionResult,
  source: string,
): CachedReading {
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
