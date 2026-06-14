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
export const BENCHMARK_K_MIN_SCHOOLS = 3 as const;
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
  suppressionReason: z.string().nullable(), // p.ej. "Cohorte insuficiente (< 3 colegios / < 20 alumnos)"
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
