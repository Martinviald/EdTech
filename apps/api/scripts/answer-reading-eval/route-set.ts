import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { resolveReadingRoute, type ResolvedRouteWithFallback } from '@soe/answer-reading';
import {
  readingRouteSchema,
  type ReaderSpec,
  type ReadingContext,
  type ReadingRoute,
} from '@soe/types';
import { z } from 'zod';

export const routeSetFileSchema = z.union([
  readingRouteSchema,
  z.object({ description: z.string().optional(), routes: z.array(readingRouteSchema).min(1) }),
]);

export interface RouteSet {
  readonly file: string;
  readonly description: string | null;
  readonly routes: readonly ReadingRoute[];
}

export type ReaderMinConfidence = Readonly<Record<string, number>>;

export async function loadRouteSet(routeFile: string): Promise<RouteSet> {
  const file = resolve(routeFile);
  const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
  const parsed = routeSetFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Rutas inválidas (${routeFile}):\n- ${issues.join('\n- ')}`);
  }
  if ('routes' in parsed.data) {
    return { file, description: parsed.data.description ?? null, routes: parsed.data.routes };
  }
  return { file, description: null, routes: [{ ...parsed.data, status: 'active' }] };
}

export function resolveSampleRoute(
  routeSet: RouteSet,
  context: ReadingContext,
): ResolvedRouteWithFallback | null {
  return resolveReadingRoute(context, routeSet.routes);
}

export function allRouteReaders(routeSet: RouteSet): ReaderSpec[] {
  const byKey = new Map<string, ReaderSpec>();
  for (const route of routeSet.routes) {
    for (const reader of route.readers) byKey.set(`${reader.provider}:${reader.model}`, reader);
    if (route.policy.tiebreakReader) {
      const tiebreak = route.policy.tiebreakReader;
      byKey.set(`${tiebreak.provider}:${tiebreak.model}`, tiebreak);
    }
  }
  return [...byKey.values()];
}

export function parseReaderMinConfidence(value: string): ReaderMinConfidence {
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const separator = entry.lastIndexOf('=');
      const key = entry.slice(0, separator).trim();
      const threshold = Number(entry.slice(separator + 1));
      if (separator <= 0 || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
        throw new Error(`Umbral por lector inválido: "${entry}" (usa clave=0.97)`);
      }
      return [key, threshold] as const;
    });
  if (entries.length === 0) throw new Error('--reader-min-confidence no trae ningún umbral');
  return Object.fromEntries(entries);
}
