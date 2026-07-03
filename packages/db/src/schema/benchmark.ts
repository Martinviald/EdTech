import {
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import type { BenchmarkBandDistribution, BenchmarkSkillAggregate } from '@soe/types';
import { benchmarkModeEnum, schoolDependenceEnum } from './enums';
import { organizations } from './organizations';
import { instruments } from './instruments';
import { users } from './users';

/**
 * Participación de una org en benchmarking (F2 S0 — H19.24). Una fila por org.
 * Guarda SOLO lo que no se deriva: opt-out del pool global anónimo + consentimiento.
 * La red/sostenedor NO se almacena aquí — se deriva de organizations.parent_id.
 * RLS por org_id (ver packages/db/sql/rls-policies.sql).
 */
export const orgBenchmarkSettings = pgTable(
  'org_benchmark_settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    optOutGlobalPool: boolean('opt_out_global_pool').notNull().default(false),
    consentGrantedAt: timestamp('consent_granted_at'),
    consentGrantedById: uuid('consent_granted_by_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [unique().on(table.orgId)],
);

export const orgBenchmarkSettingsRelations = relations(orgBenchmarkSettings, ({ one }) => ({
  org: one(organizations, {
    fields: [orgBenchmarkSettings.orgId],
    references: [organizations.id],
  }),
}));

export type OrgBenchmarkSettings = typeof orgBenchmarkSettings.$inferSelect;
export type NewOrgBenchmarkSettings = typeof orgBenchmarkSettings.$inferInsert;

/**
 * Read-model de benchmarking (F2 S4 — H7.1). Agregado por (org × instrumento ×
 * nivel × asignatura). Refrescado por schedule (el refresh itera org por org bajo
 * `withOrgContext` para construirlo SIN romper RLS en la fuente).
 *
 * ⚠️ EXCEPCIÓN DELIBERADA A RLS (CLAUDE.md §5.2): esta tabla **NO** tiene RLS —
 * se lee CROSS-TENANT por el servicio de comparación (la única excepción del
 * proyecto). Por eso NUNCA guarda PII: solo agregados por org (conteos, % logro,
 * distribución por banda, % por habilidad). El acceso se protege por guards de rol
 * y el servicio aplica k-anonimato (supresión de cohortes < k colegios / < n alumnos)
 * y nunca devuelve filas crudas de otra org en modo global.
 *
 * `optOutGlobalPool` es un SNAPSHOT del opt-out al momento del refresh: permite al
 * servicio (que corre fuera de `withOrgContext`) filtrar el pool global sin leer
 * `org_benchmark_settings` (que sí tiene RLS y sería inaccesible cross-tenant).
 * `networkOrgId` (= organizations.parent_id) habilita el modo red identificado.
 */
export const benchmarkAggregates = pgTable(
  'benchmark_aggregates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    gradeId: uuid('grade_id'),
    subjectId: uuid('subject_id'),
    // Dimensiones de cohorte desnormalizadas (de organizations) — filtrado sin join cross-tenant.
    dependence: schoolDependenceEnum('dependence'),
    region: text('region'),
    commune: text('commune'),
    networkOrgId: uuid('network_org_id'), // = organizations.parent_id (sostenedor/red)
    // Métricas agregadas (sin PII).
    studentCount: integer('student_count').notNull().default(0),
    avgAchievement: decimal('avg_achievement', { precision: 5, scale: 2 }),
    bandDistribution: jsonb('band_distribution').$type<BenchmarkBandDistribution>(),
    perSkill: jsonb('per_skill').$type<BenchmarkSkillAggregate[]>(),
    // Snapshot del opt-out del pool global al refrescar (ver doc arriba).
    optOutGlobalPool: boolean('opt_out_global_pool').notNull().default(false),
    refreshedAt: timestamp('refreshed_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    unique('benchmark_aggregates_dims_uq').on(
      table.orgId,
      table.instrumentId,
      table.gradeId,
      table.subjectId,
    ),
    index('benchmark_aggregates_cohort_idx').on(
      table.instrumentId,
      table.gradeId,
      table.subjectId,
    ),
    index('benchmark_aggregates_network_idx').on(table.networkOrgId),
  ],
);

/**
 * Auditoría de accesos al benchmarking (F2 S4 — H7.6, compliance Ley 19.628).
 * Una fila por consulta de comparación. RLS por `org_id` (cada org ve solo sus
 * propios accesos). No guarda PII de alumnos.
 */
export const benchmarkAccessLogs = pgTable(
  'benchmark_access_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id),
    mode: benchmarkModeEnum('mode').notNull(),
    instrumentId: uuid('instrument_id'),
    filters: jsonb('filters').$type<Record<string, unknown>>(),
    cohortSchoolCount: integer('cohort_school_count'),
    cohortStudentCount: integer('cohort_student_count'),
    suppressed: boolean('suppressed').notNull().default(false), // ¿se ocultó por k-anonimato?
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('benchmark_access_logs_org_idx').on(table.orgId, table.createdAt)],
);

export const benchmarkAggregatesRelations = relations(benchmarkAggregates, ({ one }) => ({
  org: one(organizations, {
    fields: [benchmarkAggregates.orgId],
    references: [organizations.id],
  }),
  instrument: one(instruments, {
    fields: [benchmarkAggregates.instrumentId],
    references: [instruments.id],
  }),
}));

export const benchmarkAccessLogsRelations = relations(benchmarkAccessLogs, ({ one }) => ({
  org: one(organizations, {
    fields: [benchmarkAccessLogs.orgId],
    references: [organizations.id],
  }),
}));

export type BenchmarkAggregate = typeof benchmarkAggregates.$inferSelect;
export type NewBenchmarkAggregate = typeof benchmarkAggregates.$inferInsert;
export type BenchmarkAccessLog = typeof benchmarkAccessLogs.$inferSelect;
export type NewBenchmarkAccessLog = typeof benchmarkAccessLogs.$inferInsert;
