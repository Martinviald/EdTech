import { z } from 'zod';
import { USER_ROLES } from '../enums';

/**
 * Telemetría de uso de la plataforma — contrato compartido `api` ↔ `web`.
 *
 * Objetivo (producto): saber qué módulos/vistas/funcionalidades usa cada usuario
 * para distinguir lo que aporta valor de lo que no. NO es auditoría de
 * cumplimiento (eso es `audit_logs`, Ley 19.628): acá va analítica de producto,
 * sin PII (nunca nombres, RUT, contenido de alumnos — solo qué se usó y cuándo).
 *
 * Diseño extensible (§8.2 CLAUDE.md — como la taxonomía universal): el catálogo
 * de eventos NO es un enum en la DB (obligaría a una migración por cada feature
 * nueva). Vive como un REGISTRO tipado acá abajo: una entrada por evento con su
 * categoría y el schema de sus `properties`. Agregar un evento nuevo = una
 * entrada en `telemetryEventDefinitions`, cero cambios de schema. Ese registro es
 * a la vez la fuente de la seguridad de tipos en compilación (`track(name, props)`
 * chequea `props` contra el evento) y la validación en runtime del backend.
 */

export const TELEMETRY_EVENT_CATEGORIES = [
  'navigation',
  'engagement',
  'import',
  'results',
  'item_bank',
  'ai',
  'benchmarking',
  'admin',
  'session',
  'system',
] as const;
export type TelemetryEventCategory = (typeof TELEMETRY_EVENT_CATEGORIES)[number];

/** Origen del evento: cliente web, backend (interceptor/servicios) o tareas del sistema. */
export const TELEMETRY_SOURCES = ['web', 'api', 'system'] as const;
export type TelemetrySource = (typeof TELEMETRY_SOURCES)[number];

/**
 * Contexto liviano del evento. SIN PII: sólo la ruta (patrón, no IDs sensibles),
 * un id de sesión de cliente efímero y metadatos de entorno. Zod descarta
 * cualquier clave no declarada al parsear (blindaje contra fugas accidentales).
 */
export const telemetryContextSchema = z.object({
  path: z.string().max(512).optional(),
  referrer: z.string().max(512).optional(),
  sessionId: z.string().max(64).optional(),
  source: z.enum(TELEMETRY_SOURCES).optional(),
  appVersion: z.string().max(64).optional(),
  viewport: z
    .object({
      w: z.number().int().nonnegative(),
      h: z.number().int().nonnegative(),
    })
    .optional(),
  // Dispositivo/origen del cliente. Los fija el SERVIDOR (interceptor) a partir de
  // la request real — nunca se confía en lo que mande el cliente. Sirven para
  // distinguir el origen de un `api.request` (navegador vs script vs bot vs IP).
  userAgent: z.string().max(512).optional(),
  ip: z.string().max(64).optional(),
});
export type TelemetryContext = z.infer<typeof telemetryContextSchema>;

/** Forma de una entrada del registro: su categoría y el schema Zod de sus `properties`. */
export type TelemetryEventDefinition = {
  category: TelemetryEventCategory;
  properties: z.ZodType;
};

/**
 * REGISTRO DE EVENTOS — fuente única de verdad de la taxonomía de telemetría.
 *
 * Convención de nombres: `dominio.acción` (`page.viewed`, `export.generated`).
 * Cada `properties` es cerrado y tipado: son las dimensiones por las que después
 * se agrega/segmenta la analítica. Para instrumentar algo nuevo, agregá una
 * entrada acá — no toques el schema de la DB ni la ingesta.
 */
export const telemetryEventDefinitions = {
  'page.viewed': {
    category: 'navigation',
    properties: z.object({
      path: z.string().min(1).max(512),
      title: z.string().max(200).optional(),
      section: z.string().max(64).optional(),
    }),
  },
  'feature.used': {
    category: 'engagement',
    properties: z.object({
      feature: z.string().min(1).max(120),
      surface: z.string().max(120).optional(),
      metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    }),
  },
  'export.generated': {
    category: 'results',
    properties: z.object({
      format: z.enum(['xlsx', 'pdf', 'csv']),
      surface: z.string().min(1).max(120),
      rowCount: z.number().int().nonnegative().optional(),
    }),
  },
  'import.committed': {
    category: 'import',
    properties: z.object({
      kind: z.string().min(1).max(64),
      created: z.number().int().nonnegative().optional(),
      updated: z.number().int().nonnegative().optional(),
      rowCount: z.number().int().nonnegative().optional(),
    }),
  },
  'session.role_switched': {
    category: 'session',
    properties: z.object({
      to: z.enum(USER_ROLES),
      from: z.enum(USER_ROLES).optional(),
    }),
  },
  'session.org_switched': {
    category: 'session',
    properties: z.object({
      toOrgId: z.string().uuid(),
    }),
  },
  'api.request': {
    category: 'system',
    properties: z.object({
      method: z.string().min(1).max(10),
      route: z.string().min(1).max(200),
      status: z.number().int(),
      durationMs: z.number().int().nonnegative(),
    }),
  },
} as const satisfies Record<string, TelemetryEventDefinition>;

export type TelemetryEventName = keyof typeof telemetryEventDefinitions;

export const TELEMETRY_EVENT_NAMES = Object.keys(
  telemetryEventDefinitions,
) as TelemetryEventName[];

/** Mapa `nombre → tipo de sus properties`, derivado del registro para tipar `track()`. */
export type TelemetryEventPropertiesMap = {
  [K in TelemetryEventName]: z.infer<(typeof telemetryEventDefinitions)[K]['properties']>;
};

/** Firma tipada de emisión de eventos, compartida por el `track` del cliente y del backend. */
export type TrackFn = <K extends TelemetryEventName>(
  name: K,
  properties: TelemetryEventPropertiesMap[K],
) => void;

export function getTelemetryEventDefinition(
  name: string,
): TelemetryEventDefinition | undefined {
  return (telemetryEventDefinitions as Record<string, TelemetryEventDefinition>)[name];
}

export type ValidatedTelemetryEvent = {
  name: TelemetryEventName;
  category: TelemetryEventCategory;
  properties: Record<string, unknown>;
};

/**
 * Valida un `(nombre, properties)` crudo contra el registro. Devuelve `null` si
 * el evento es desconocido o sus properties no calzan. La telemetría NUNCA debe
 * lanzar hacia un flujo de usuario: el llamador descarta el evento inválido en
 * vez de fallar (best-effort).
 */
export function parseTelemetryEvent(
  name: string,
  properties: unknown,
): ValidatedTelemetryEvent | null {
  const def = getTelemetryEventDefinition(name);
  if (!def) return null;
  const result = def.properties.safeParse(properties ?? {});
  if (!result.success) return null;
  return {
    name: name as TelemetryEventName,
    category: def.category,
    properties: result.data as Record<string, unknown>,
  };
}

// ── Ingesta (cliente → API) ──────────────────────────────────────────────────

/** Un evento tal como lo envía el cliente. El backend re-valida contra el registro. */
export const telemetryEventInputSchema = z.object({
  name: z.string().min(1).max(120),
  occurredAt: z.string().datetime().optional(),
  properties: z.record(z.unknown()).default({}),
  context: telemetryContextSchema.optional(),
});
export type TelemetryEventInput = z.infer<typeof telemetryEventInputSchema>;

/** Lote de eventos. Acotado para que un cliente no pueda inundar la ingesta. */
export const ingestTelemetrySchema = z.object({
  events: z.array(telemetryEventInputSchema).min(1).max(50),
});
export type IngestTelemetryDto = z.infer<typeof ingestTelemetrySchema>;

export type IngestTelemetryResponse = {
  accepted: number;
  rejected: number;
};

// ── Consumo (agregación de uso) ──────────────────────────────────────────────

export const TELEMETRY_USAGE_GROUP_BY = ['event', 'category', 'role', 'day'] as const;
export type TelemetryUsageGroupBy = (typeof TELEMETRY_USAGE_GROUP_BY)[number];

export const telemetryUsageQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  category: z.enum(TELEMETRY_EVENT_CATEGORIES).optional(),
  groupBy: z.enum(TELEMETRY_USAGE_GROUP_BY).default('event'),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
export type TelemetryUsageQuery = z.infer<typeof telemetryUsageQuerySchema>;

export type TelemetryUsageRow = {
  key: string;
  label: string;
  eventCount: number;
  uniqueUsers: number;
};

export type TelemetryUsageResponse = {
  groupBy: TelemetryUsageGroupBy;
  from: string | null;
  to: string | null;
  totalEvents: number;
  uniqueUsers: number;
  rows: TelemetryUsageRow[];
};
