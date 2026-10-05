import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// F2 S4 — Benchmarking Institucional. Contratos del módulo `benchmarking`
// (apps/api/src/benchmarking/, ruta base /api/benchmarking) y la UI /benchmarking.
//
// Comparación MISMO-INSTRUMENTO (misma forma/nivel oficial): apples-to-apples.
// Dos modos: pool GLOBAL anónimo (k-anonimato) y RED identificada (orgs con el
// mismo organizations.parent_id). El read-model es cross-tenant (sin RLS) y SOLO
// guarda agregados por org (cero PII). Ver packages/db/src/schema/benchmark.ts.
// ─────────────────────────────────────────────────────────────────────────────

// ── Umbrales de k-anonimato — FUENTE ÚNICA (cambiar aquí ajusta todo el sistema) ──
// Una cohorte del pool GLOBAL solo se muestra si tiene ≥ k colegios Y ≥ n alumnos;
// si no, se SUPRIME (anti-reidentificación, Ley 19.628). El modo RED es identificado
// por acuerdo del sostenedor y NO aplica supresión por k.
// ⚠️ k = 2 es PROVISORIO: con dos colegios cada uno puede despejar el agregado del
// otro restando el suyo. Se aceptó porque los dos colegios reales de hoy (CSCJ y San
// Agustín) son de la misma red, Fundación Tupungato. Volver a 3 cuando entre un
// colegio fuera de esa red.
export const BENCHMARK_K_MIN_SCHOOLS = 2 as const;
export const BENCHMARK_N_MIN_STUDENTS = 20 as const;

export const benchmarkModeSchema = z.enum(['global', 'network']);
export type BenchmarkMode = z.infer<typeof benchmarkModeSchema>;

// ── Sub-modelos de agregados (compartidos con el read-model en @soe/db) ──

/** Conteo de alumnos por banda de desempeño. */
export const benchmarkBandDistributionSchema = z.object({
  insufficient: z.number().int(),
  elementary: z.number().int(),
  adequate: z.number().int(),
  advanced: z.number().int(),
});
export type BenchmarkBandDistribution = z.infer<typeof benchmarkBandDistributionSchema>;

/** Agregado por habilidad (nodo de taxonomía) — guardado en el read-model. */
export const benchmarkSkillAggregateSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  achievement: z.number().nullable(), // % logro promedio del grupo
  studentCount: z.number().int(),
});
export type BenchmarkSkillAggregate = z.infer<typeof benchmarkSkillAggregateSchema>;

/**
 * Conteo de alumnos por banda PROPIA del instrumento (p. ej. DIA Nivel I/II/III).
 * Reemplaza a la proyección legacy de 4 niveles para todo lo que se muestra al lado
 * de las vistas de resultados, que hablan en las bandas del instrumento.
 */
export const benchmarkBandCountSchema = z.object({
  bandKey: z.string(),
  label: z.string(),
  order: z.number().int(),
  count: z.number().int(),
});
export type BenchmarkBandCount = z.infer<typeof benchmarkBandCountSchema>;

// ── Muestra por instrumento (benchmarking en contexto) ──
// Ver docs/diseno-benchmarking-en-contexto.md §4–§5 y §8.2.

export const BENCHMARK_SAMPLES_MAX_INSTRUMENTS = 50 as const;

/** Bajo esta diferencia (pp) el colegio se muestra "≈ muestra". */
export const BENCHMARK_SAMPLE_EQUAL_PP = 0.5 as const;

export const benchmarkSampleScopeSchema = z.enum(['global', 'network']);
export type BenchmarkSampleScope = z.infer<typeof benchmarkSampleScopeSchema>;

/** Posición frente a la zona típica (p25–p75 del % de logro de los colegios). */
export const typicalZoneSchema = z.enum(['below', 'within', 'above']);
export type TypicalZone = z.infer<typeof typicalZoneSchema>;

/** Estadística de la muestra en un nodo de la taxonomía. */
export const sampleSkillStatSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  achievement: z.number().nullable(), // ponderado por alumnos
  studentCount: z.number().int(),
  schoolCount: z.number().int(),
  p10: z.number().nullable(), // sobre el % de los colegios en el nodo
  p25: z.number().nullable(),
});
export type SampleSkillStat = z.infer<typeof sampleSkillStatSchema>;

/** Muestra de un instrumento: los colegios que lo rindieron, agregados. */
export const instrumentSampleSchema = z.object({
  instrumentId: z.string().uuid(),
  scope: benchmarkSampleScopeSchema,
  label: z.string(), // "Muestra" | nombre de la red
  schoolCount: z.number().int(),
  studentCount: z.number().int(),
  avgAchievement: z.number().nullable(), // ponderado por alumnos
  p10: z.number().nullable(), // percentiles sobre el % de logro de los colegios
  p25: z.number().nullable(),
  median: z.number().nullable(),
  p75: z.number().nullable(),
  bandCounts: z.array(benchmarkBandCountSchema),
  perSkill: z.array(sampleSkillStatSchema),
  refreshedAt: z.string(),
});
export type InstrumentSample = z.infer<typeof instrumentSampleSchema>;

/** Dónde queda el colegio del caller dentro de la muestra global. */
export const yourSamplePositionSchema = z.object({
  avgAchievement: z.number().nullable(),
  studentCount: z.number().int(),
  percentile: z.number().nullable(),
  typicalZone: typicalZoneSchema.nullable(),
});
export type YourSamplePosition = z.infer<typeof yourSamplePositionSchema>;

export const instrumentSampleEntrySchema = z.object({
  instrumentId: z.string().uuid(),
  global: instrumentSampleSchema.nullable(), // null si no cumple k-anonimato
  network: instrumentSampleSchema.nullable(), // null si el colegio no tiene red
  you: yourSamplePositionSchema.nullable(), // null si el colegio no rindió el instrumento
});
export type InstrumentSampleEntry = z.infer<typeof instrumentSampleEntrySchema>;

export const instrumentSamplesResponseSchema = z.object({
  data: z.array(instrumentSampleEntrySchema),
});
export type InstrumentSamplesResponse = z.infer<typeof instrumentSamplesResponseSchema>;

/** `?instrumentIds=a,b,c` (también acepta el parámetro repetido). */
export const instrumentSamplesQuerySchema = z.object({
  instrumentIds: z.preprocess((value) => {
    const raw = Array.isArray(value) ? value : [value];
    return raw
      .flatMap((v) => (typeof v === 'string' ? v.split(',') : []))
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }, z.array(z.string().uuid()).min(1).max(BENCHMARK_SAMPLES_MAX_INSTRUMENTS)),
});
export type InstrumentSamplesQueryDto = z.infer<typeof instrumentSamplesQuerySchema>;

// ── Selector de instrumentos comparables ──

/** Un instrumento sobre el que la org tiene datos y puede compararse. */
export const benchmarkInstrumentOptionSchema = z.object({
  instrumentId: z.string().uuid(),
  instrumentName: z.string(),
  gradeId: z.string().uuid().nullable(),
  gradeName: z.string().nullable(),
  subjectId: z.string().uuid().nullable(),
  subjectName: z.string().nullable(),
  yourStudentCount: z.number().int(), // alumnos de la org en este instrumento
});
export type BenchmarkInstrumentOption = z.infer<typeof benchmarkInstrumentOptionSchema>;

export const benchmarkInstrumentListResponseSchema = z.object({
  data: z.array(benchmarkInstrumentOptionSchema),
});
export type BenchmarkInstrumentListResponse = z.infer<
  typeof benchmarkInstrumentListResponseSchema
>;

// ── Consulta de comparación ──

export const benchmarkComparisonQuerySchema = z.object({
  instrumentId: z.string().uuid(),
  gradeId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  mode: benchmarkModeSchema.default('global'),
  // Filtros de cohorte (solo modo global; el modo red usa el parent_id del caller).
  dependence: z.string().optional(),
  region: z.string().optional(),
  commune: z.string().optional(),
});
export type BenchmarkComparisonQueryDto = z.infer<typeof benchmarkComparisonQuerySchema>;

// ── Modelos de respuesta de la comparación ──

/** Desempeño de TU colegio en el instrumento. */
export const schoolBenchmarkSchema = z.object({
  avgAchievement: z.number().nullable(), // % logro
  studentCount: z.number().int(),
  bandDistribution: benchmarkBandDistributionSchema,
  percentile: z.number().nullable(), // posición percentil dentro de la cohorte (0..100)
  perSkill: z.array(benchmarkSkillAggregateSchema),
});
export type SchoolBenchmark = z.infer<typeof schoolBenchmarkSchema>;

/** Estadística de habilidad a nivel de cohorte (vs tu colegio). */
export const cohortSkillStatSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  cohortAchievement: z.number().nullable(),
  yourAchievement: z.number().nullable(),
  delta: z.number().nullable(), // tu colegio − cohorte (signo = sobre/bajo)
});
export type CohortSkillStat = z.infer<typeof cohortSkillStatSchema>;

/** Agregado de la cohorte (anonimizado en modo global). */
export const cohortBenchmarkSchema = z.object({
  schoolCount: z.number().int(),
  studentCount: z.number().int(),
  avgAchievement: z.number().nullable(),
  median: z.number().nullable(), // mediana del % logro entre colegios
  p25: z.number().nullable(),
  p75: z.number().nullable(),
  bandDistribution: benchmarkBandDistributionSchema, // proporciones agregadas de la cohorte
  perSkill: z.array(cohortSkillStatSchema),
});
export type CohortBenchmark = z.infer<typeof cohortBenchmarkSchema>;

/** Fila identificada de un colegio de la red (solo modo `network`). */
export const networkSchoolRowSchema = z.object({
  orgId: z.string().uuid(),
  orgName: z.string(),
  isYou: z.boolean(),
  avgAchievement: z.number().nullable(),
  studentCount: z.number().int(),
  bandDistribution: benchmarkBandDistributionSchema,
});
export type NetworkSchoolRow = z.infer<typeof networkSchoolRowSchema>;

/** Respuesta completa de la comparación de benchmarking. */
export const benchmarkComparisonResponseSchema = z.object({
  mode: benchmarkModeSchema,
  instrumentId: z.string().uuid(),
  instrumentName: z.string(),
  // Supresión por k-anonimato (solo modo global): si true, no se exponen cohort/yourSchool.
  suppressed: z.boolean(),
  suppressionReason: z.string().nullable(), // p.ej. "Cohorte insuficiente (< 2 colegios / < 20 alumnos)"
  yourSchool: schoolBenchmarkSchema.nullable(),
  cohort: cohortBenchmarkSchema.nullable(),
  // Solo modo `network`: comparación identificada con los colegios del sostenedor.
  networkSchools: z.array(networkSchoolRowSchema).nullable(),
  thresholds: z.object({
    kMinSchools: z.number().int(),
    nMinStudents: z.number().int(),
  }),
});
export type BenchmarkComparisonResponse = z.infer<typeof benchmarkComparisonResponseSchema>;

// ── Refresh del read-model (H7.1) ──

export const benchmarkRefreshResponseSchema = z.object({
  refreshedOrgs: z.number().int(),
  refreshedRows: z.number().int(),
  refreshedAt: z.string(),
});
export type BenchmarkRefreshResponse = z.infer<typeof benchmarkRefreshResponseSchema>;

// ── Auditoría de accesos (H7.6) ──

export const benchmarkAccessLogModelSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  mode: benchmarkModeSchema,
  instrumentId: z.string().uuid().nullable(),
  filters: z.record(z.string(), z.unknown()).nullable(),
  cohortSchoolCount: z.number().int().nullable(),
  cohortStudentCount: z.number().int().nullable(),
  suppressed: z.boolean(),
  createdAt: z.string(),
});
export type BenchmarkAccessLogModel = z.infer<typeof benchmarkAccessLogModelSchema>;

export const benchmarkAuditListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type BenchmarkAuditListQueryDto = z.infer<typeof benchmarkAuditListQuerySchema>;

export const benchmarkAuditListResponseSchema = z.object({
  data: z.array(benchmarkAccessLogModelSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});
export type BenchmarkAuditListResponse = z.infer<typeof benchmarkAuditListResponseSchema>;
