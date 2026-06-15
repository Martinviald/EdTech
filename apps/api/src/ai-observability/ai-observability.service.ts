import { ForbiddenException, Injectable } from '@nestjs/common';
import { and, eq, gte, isNull, lte } from 'drizzle-orm';
import {
  aiAnalyses,
  organizations,
  remedialMaterials,
  withOrgContext,
  type AiAnalysis,
  type RemedialMaterial,
} from '@soe/db';
import {
  orgConfigSchema,
  type AiBudgetStatus,
  type AiCostBucket,
  type AiCostTimeseriesResponse,
  type AiObservabilitySummary,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';

// ──────────────────────────────────────────────────────────────────────────────
// H19.25 — Observabilidad de costo/latencia IA.
//
// Agrega filas YA PERSISTIDAS de `ai_analyses` y `remedial_materials` (costo,
// tokens, modelo, status, timestamps). NO llama al LLM. Ambas tablas están bajo
// RLS → TODA query corre dentro de `withOrgContext(this.db, orgId, tx => …)`.
//
// La tabla `organizations` NO tiene RLS → se lee con `this.db` directo para
// resolver `org.config.aiBudgetUsd` (mismo patrón que organizations.service).
// ──────────────────────────────────────────────────────────────────────────────

/** Estados terminales "completados" por tabla (latencia sólo sobre estos). */
const ANALYSIS_COMPLETED = 'completed';
const REMEDIAL_COMPLETED: ReadonlySet<string> = new Set(['ready', 'approved', 'discarded']);

/** Una fila normalizada de gasto IA, independiente de la tabla de origen. */
interface NormalizedRow {
  source: 'ai_analysis' | 'remedial';
  type: string;
  model: string | null;
  status: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number | null;
  createdAt: Date;
  isFailed: boolean;
}

/** Acumulador mutable de un bucket (luego se materializa a AiCostBucket). */
interface BucketAccumulator {
  key: string;
  label: string;
  count: number;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  latencySum: number;
  latencyCount: number;
}

const ANALYSIS_TYPE_LABELS: Record<string, string> = {
  assessment_insights: 'Insights de evaluación',
  skill_gaps: 'Brechas de habilidad',
  item_analysis: 'Análisis de ítems',
  general: 'General',
};

const REMEDIAL_TYPE_LABELS: Record<string, string> = {
  guide: 'Guía de reenseñanza',
  practice_set: 'Set de práctica',
  group_plan: 'Plan por grupo',
};

const SOURCE_LABELS: Record<NormalizedRow['source'], string> = {
  ai_analysis: 'Análisis IA',
  remedial: 'Material remedial',
};

@Injectable()
export class AiObservabilityService {
  constructor(@InjectDb() private readonly db: Database) {}

  // ───────────────────────────────────────────────────────────────────────────
  // GET /ai-observability/summary?from&to
  // ───────────────────────────────────────────────────────────────────────────

  async getSummary(
    user: JwtPayload,
    from?: string,
    to?: string,
  ): Promise<AiObservabilitySummary> {
    const orgId = this.requireOrgId(user);
    const range = resolveRange(from, to);

    const rows = await this.fetchRows(orgId, range.start, range.end);

    const totals = this.computeTotals(rows);

    return {
      orgId,
      from: toIsoDate(range.start),
      to: toIsoDate(range.end),
      totals,
      bySource: this.bucketize(rows, (r) => ({ key: r.source, label: SOURCE_LABELS[r.source] })),
      byType: this.bucketize(rows, (r) => ({ key: typeKey(r), label: typeLabel(r) })),
      byModel: this.bucketize(rows, (r) => {
        const key = r.model ?? 'unknown';
        return { key, label: r.model ?? 'desconocido' };
      }),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GET /ai-observability/budget (mes calendario actual)
  // ───────────────────────────────────────────────────────────────────────────

  async getBudget(user: JwtPayload): Promise<AiBudgetStatus> {
    const orgId = this.requireOrgId(user);
    const now = new Date();
    const start = startOfMonth(now);
    const end = endOfMonth(now);

    const rows = await this.fetchRows(orgId, start, end);
    const monthSpendUsd = round6(rows.reduce((sum, r) => sum + r.costUsd, 0));

    const budgetUsd = await this.resolveBudget(orgId);

    const pctUsed =
      budgetUsd && budgetUsd > 0 ? round2((monthSpendUsd / budgetUsd) * 100) : null;

    return {
      orgId,
      month: monthKey(now),
      monthSpendUsd,
      budgetUsd,
      pctUsed,
      alertLevel: resolveAlertLevel(pctUsed),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // GET /ai-observability/timeseries?from&to (gasto diario)
  // ───────────────────────────────────────────────────────────────────────────

  async getTimeseries(
    user: JwtPayload,
    from?: string,
    to?: string,
  ): Promise<AiCostTimeseriesResponse> {
    const orgId = this.requireOrgId(user);
    const range = resolveRange(from, to);

    const rows = await this.fetchRows(orgId, range.start, range.end);

    const byDay = new Map<string, { costUsd: number; count: number }>();
    for (const row of rows) {
      const date = toIsoDate(row.createdAt);
      const entry = byDay.get(date) ?? { costUsd: 0, count: 0 };
      entry.costUsd += row.costUsd;
      entry.count += 1;
      byDay.set(date, entry);
    }

    const points = [...byDay.entries()]
      .map(([date, v]) => ({ date, costUsd: round6(v.costUsd), count: v.count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      orgId,
      from: toIsoDate(range.start),
      to: toIsoDate(range.end),
      points,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Acceso a datos (ambas tablas bajo RLS → withOrgContext, usando `tx`)
  // ───────────────────────────────────────────────────────────────────────────

  /** Lee filas de ai_analyses + remedial_materials en el rango, normalizadas. */
  private async fetchRows(orgId: string, start: Date, end: Date): Promise<NormalizedRow[]> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const analysisRows = (await tx
        .select()
        .from(aiAnalyses)
        .where(
          and(
            eq(aiAnalyses.orgId, orgId),
            isNull(aiAnalyses.deletedAt),
            gte(aiAnalyses.createdAt, start),
            lte(aiAnalyses.createdAt, end),
          ),
        )) as AiAnalysis[];

      const remedialRows = (await tx
        .select()
        .from(remedialMaterials)
        .where(
          and(
            eq(remedialMaterials.orgId, orgId),
            isNull(remedialMaterials.deletedAt),
            gte(remedialMaterials.createdAt, start),
            lte(remedialMaterials.createdAt, end),
          ),
        )) as RemedialMaterial[];

      return [
        ...analysisRows.map((r) => normalizeAnalysis(r)),
        ...remedialRows.map((r) => normalizeRemedial(r)),
      ];
    });
  }

  /** Lee `org.config.aiBudgetUsd` (tabla sin RLS, this.db directo). */
  private async resolveBudget(orgId: string): Promise<number | null> {
    const [org] = await this.db
      .select({ config: organizations.config })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);

    if (!org) return null;

    const parsed = orgConfigSchema.safeParse(org.config ?? {});
    if (!parsed.success) return null;

    const budget = parsed.data.aiBudgetUsd;
    return typeof budget === 'number' && budget > 0 ? budget : null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Agregación (pura, en memoria)
  // ───────────────────────────────────────────────────────────────────────────

  private computeTotals(rows: NormalizedRow[]): AiObservabilitySummary['totals'] {
    let totalCostUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let latencySum = 0;
    let latencyCount = 0;
    let failedCount = 0;

    for (const row of rows) {
      totalCostUsd += row.costUsd;
      inputTokens += row.inputTokens;
      outputTokens += row.outputTokens;
      if (row.latencyMs !== null) {
        latencySum += row.latencyMs;
        latencyCount += 1;
      }
      if (row.isFailed) failedCount += 1;
    }

    return {
      count: rows.length,
      totalCostUsd: round6(totalCostUsd),
      inputTokens,
      outputTokens,
      avgLatencyMs: latencyCount > 0 ? Math.round(latencySum / latencyCount) : null,
      failedCount,
    };
  }

  /** Agrupa las filas según la `keyFn` y materializa buckets ordenados por costo. */
  private bucketize(
    rows: NormalizedRow[],
    keyFn: (row: NormalizedRow) => { key: string; label: string },
  ): AiCostBucket[] {
    const acc = new Map<string, BucketAccumulator>();

    for (const row of rows) {
      const { key, label } = keyFn(row);
      const bucket =
        acc.get(key) ??
        {
          key,
          label,
          count: 0,
          totalCostUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          latencySum: 0,
          latencyCount: 0,
        };
      bucket.count += 1;
      bucket.totalCostUsd += row.costUsd;
      bucket.inputTokens += row.inputTokens;
      bucket.outputTokens += row.outputTokens;
      if (row.latencyMs !== null) {
        bucket.latencySum += row.latencyMs;
        bucket.latencyCount += 1;
      }
      acc.set(key, bucket);
    }

    return [...acc.values()]
      .map((b) => ({
        key: b.key,
        label: b.label,
        count: b.count,
        totalCostUsd: round6(b.totalCostUsd),
        inputTokens: b.inputTokens,
        outputTokens: b.outputTokens,
        avgLatencyMs: b.latencyCount > 0 ? Math.round(b.latencySum / b.latencyCount) : null,
      }))
      .sort((a, b) => b.totalCostUsd - a.totalCostUsd || a.label.localeCompare(b.label));
  }

  private requireOrgId(user: JwtPayload): string {
    if (user.orgId === null) {
      throw new ForbiddenException('Usuario sin organización activa');
    }
    return user.orgId;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers puros (fáciles de testear)
// ─────────────────────────────────────────────────────────────────────────────

function normalizeAnalysis(row: AiAnalysis): NormalizedRow {
  return {
    source: 'ai_analysis',
    type: row.analysisType,
    model: row.model,
    status: row.status,
    costUsd: parseCost(row.costUsd),
    inputTokens: row.tokens?.input ?? 0,
    outputTokens: row.tokens?.output ?? 0,
    latencyMs: computeLatency(row.status === ANALYSIS_COMPLETED, row.startedAt, row.completedAt),
    createdAt: row.createdAt,
    isFailed: row.status === 'failed',
  };
}

function normalizeRemedial(row: RemedialMaterial): NormalizedRow {
  return {
    source: 'remedial',
    type: row.type,
    model: row.model,
    status: row.status,
    costUsd: parseCost(row.costUsd),
    inputTokens: row.tokens?.input ?? 0,
    outputTokens: row.tokens?.output ?? 0,
    latencyMs: computeLatency(REMEDIAL_COMPLETED.has(row.status), row.startedAt, row.completedAt),
    createdAt: row.createdAt,
    isFailed: row.status === 'failed',
  };
}

/** `costUsd` viene como decimal (string) o null → Number, null→0. */
function parseCost(value: string | null): number {
  if (value === null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Latencia ms sólo si está completado y tiene ambos timestamps; si no, null. */
function computeLatency(
  isCompleted: boolean,
  startedAt: Date | null,
  completedAt: Date | null,
): number | null {
  if (!isCompleted || !startedAt || !completedAt) return null;
  const ms = completedAt.getTime() - startedAt.getTime();
  return ms >= 0 ? ms : null;
}

function typeKey(row: NormalizedRow): string {
  return `${row.source}:${row.type}`;
}

function typeLabel(row: NormalizedRow): string {
  if (row.source === 'ai_analysis') {
    return ANALYSIS_TYPE_LABELS[row.type] ?? row.type;
  }
  return REMEDIAL_TYPE_LABELS[row.type] ?? row.type;
}

interface DateRange {
  start: Date;
  end: Date;
}

/** Rango efectivo: default últimos 30 días (incl. hoy). ISO date (YYYY-MM-DD). */
function resolveRange(from?: string, to?: string): DateRange {
  const end = parseDate(to) ?? new Date();
  const start = parseDate(from) ?? new Date(end.getTime() - 29 * DAY_MS);
  // Normaliza a límites de día UTC para incluir todo el rango.
  return { start: startOfDay(start), end: endOfDay(end) };
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function endOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

function endOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

function resolveAlertLevel(pctUsed: number | null): AiBudgetStatus['alertLevel'] {
  if (pctUsed === null) return 'ok';
  if (pctUsed > 100) return 'over';
  if (pctUsed >= 80) return 'warning';
  return 'ok';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
