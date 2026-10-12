import { z } from 'zod';
import { consensusPolicySchema } from './consensus.schema';
import { readerSpecSchema } from './reader.schema';
import { responseFormatKindSchema, responseFormatSchema } from './response-format.schema';

// Rutas de lectura (diseño §6.4): QUÉ lectores, con qué prompt y qué política.
// Los prompts viven en el código; la ruta (en BDD) solo los referencia.
// Precedencia de más a menos específica; en el mismo nivel la org gana a la global.

export const ROUTE_MATCH_LEVELS = [
  'item',
  'instrument',
  'format_subject_grade',
  'format_subject',
  'format',
  'default',
] as const;
export type RouteMatchLevel = (typeof ROUTE_MATCH_LEVELS)[number];
export const routeMatchLevelSchema = z.enum(ROUTE_MATCH_LEVELS);

export const ROUTE_STATUSES = ['shadow', 'active', 'retired'] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];

export const readingContextSchema = z.object({
  orgId: z.string().uuid(),
  itemId: z.string().uuid(),
  instrumentId: z.string().uuid(),
  subjectId: z.string().uuid().nullable(),
  gradeId: z.string().uuid().nullable(),
  responseFormat: responseFormatSchema,
});
export type ReadingContext = z.infer<typeof readingContextSchema>;

// Forma de una fila de `reading_routes` tal como la consume la resolución pura.
export const readingRouteSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  orgId: z.string().uuid().nullable(),
  status: z.enum(ROUTE_STATUSES),
  level: routeMatchLevelSchema,
  itemId: z.string().uuid().nullable(),
  instrumentId: z.string().uuid().nullable(),
  formatKind: responseFormatKindSchema.nullable(),
  subjectId: z.string().uuid().nullable(),
  gradeId: z.string().uuid().nullable(),
  readers: z.array(readerSpecSchema).min(1),
  fallbackReaders: z.array(readerSpecSchema),
  shadowReaders: z.array(readerSpecSchema),
  shadowSampleRate: z.number().min(0).max(1),
  policy: consensusPolicySchema,
});
export type ReadingRoute = z.infer<typeof readingRouteSchema>;

export const resolvedRouteSchema = z.object({
  routeId: z.string().uuid(),
  routeVersion: z.number().int().positive(),
  matchedLevel: routeMatchLevelSchema,
  readers: z.array(readerSpecSchema),
  shadowReaders: z.array(readerSpecSchema),
  policy: consensusPolicySchema,
});
export type ResolvedRoute = z.infer<typeof resolvedRouteSchema>;
