/**
 * Corrección NO destructiva del momento de aplicación en una BDD ya desplegada.
 *
 *   DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db db:fix:application-period --dry-run
 *   DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db db:fix:application-period
 *
 * Contexto: el filtro "Momento" de /resultados filtra por
 * `instruments.application_period`. Un instrumento COMPARTIDO entre evaluaciones de
 * varios momentos no puede declarar ninguno, así que queda en NULL y sus evaluaciones
 * son invisibles bajo cualquier momento. `db:backfill:application-period` no lo puede
 * arreglar (no hay un momento único que deducir).
 *
 * Este script lo parte, SIN BORRAR NADA:
 *  1. El instrumento original conserva sus ítems y se queda con el momento MAYORITARIO
 *     entre sus evaluaciones.
 *  2. Por cada otro momento presente, crea un instrumento nuevo + copia de sus ítems +
 *     copia de los tags de taxonomía.
 *  3. Re-apunta a los instrumentos/ítems nuevos: `assessments.instrument_id`,
 *     `responses.item_id` y `assessment_item_stats.item_id` (por `position`).
 *
 * No hay un solo DELETE. Lo único que se desactiva es una banda de logro obsoleta
 * (soft-delete, ver abajo), y sólo si NO está referenciada por ningún resultado.
 *
 * ⚠️ Bandas de logro. `db:seed:performance-bands` SÓLO cubre instrumentos globales
 * (`org_id IS NULL`); las de un instrumento de org no las resiembra nadie. Por eso:
 *  · Instrumento GLOBAL con las bandas del momento equivocado (el DIA usa 2 en
 *    Diagnóstico y 3 en Monitoreo/Cierre) → soft-delete para que el seed siembre las
 *    correctas, y sólo si NINGÚN resultado las referencia.
 *  · Instrumento DE ORG → NO se tocan (se administran por el endpoint platform_admin).
 *    Soft-deletearlas lo dejaría sin bandas y el scoring caería al enum legacy 40/70/85.
 *  · Los instrumentos nuevos del split HEREDAN una copia de las bandas activas del
 *    original, para que sus evaluaciones conserven el mismo corte que tenían.
 * Si una corrida previa dejó un instrumento de org sin bandas activas pero con bandas
 * soft-deleteadas, el script las RESTAURA (reversión de ese bug).
 *
 * Idempotente: los UUID de lo que crea son determinísticos y cada paso comprueba si ya
 * está hecho. Correrlo dos veces deja el mismo estado.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  inferApplicationPeriodFromName,
  type InstrumentApplicationPeriod,
} from '@soe/types';
import { createDbClient, type Database } from '../client';
import { withOrgContext } from '../with-org-context';
import { instruments } from '../schema/instruments';
import { items, itemTaxonomyTags } from '../schema/items';
import { assessments } from '../schema/assessments';
import { responses } from '../schema/responses';
import {
  assessmentItemStats,
  assessmentResults,
  performanceBands,
  skillResults,
} from '../schema/results';

// Instrumentos a partir, y el prefijo de UUID determinístico para lo que se cree a
// partir de cada uno. El prefijo debe ser libre en la BDD destino.
const SPLIT_TARGETS = [
  {
    instrumentId: 'a3e00000-0000-0000-0000-000000000500',
    newInstrumentPrefix: 'a3e00000-0000-0000-0000-00000005',
    newItemPrefix: 'a3e00000-0000-0000-0000-00000020',
    newTagPrefix: 'a3e00000-0000-0000-0000-00000028',
    newBandPrefix: 'a3e00000-0000-0000-0000-00000029',
  },
] as const;

// Instrumentos cuyo momento es inequívoco: un solo momento entre sus evaluaciones (o
// ninguna evaluación). No requieren split, sólo setear la columna.
//
// `name` fuerza un nombre concreto; sin él se deriva del actual agregándole el momento.
// Los dos de benchmarking lo traen porque su nombre ya cargaba el año en otro formato
// ("(Oficial 2026)") y se alinean al que produce hoy `benchmark-demo.ts`. Los demás NO
// llevan año a propósito: en el demo un mismo instrumento cubre evaluaciones de varios
// años, así que ponerle uno sería mentir.
const DIRECT_TARGETS: ReadonlyArray<{
  instrumentId: string;
  period: InstrumentApplicationPeriod;
  name?: string;
}> = [
  { instrumentId: 'a3e00000-0000-0000-0000-000000000501', period: 'diagnostico' },
  {
    instrumentId: 'b3c00000-0000-0000-0000-000000000101',
    period: 'diagnostico',
    name: 'DIA Lectura 2° Básico 2026 — Diagnóstico (Oficial)',
  },
  {
    instrumentId: 'b3c00000-0000-0000-0000-000000000102',
    period: 'diagnostico',
    name: 'DIA Matemática 2° Básico 2026 — Diagnóstico (Oficial)',
  },
];

const ORDERED_PERIODS: readonly InstrumentApplicationPeriod[] = [
  'diagnostico',
  'intermedio',
  'cierre',
];

type Plan = {
  lines: string[];
  writes: Array<(tx: Database) => Promise<void>>;
};

function periodOfAssessment(config: unknown, name: string): InstrumentApplicationPeriod | null {
  const raw = (config ?? {}) as Record<string, unknown>;
  const fromConfig =
    typeof raw.period === 'string' ? inferApplicationPeriodFromName(raw.period) : null;
  return fromConfig ?? inferApplicationPeriodFromName(name);
}

/** Nombre del instrumento con el momento explícito, en el formato de los DIA reales. */
function nameWithPeriod(baseName: string, period: InstrumentApplicationPeriod): string {
  const stripped = baseName.replace(/\s*—\s*(Diagnóstico|Intermedio|Monitoreo|Cierre)\s*$/i, '');
  const suffix =
    period === 'intermedio' ? 'Intermedio' : INSTRUMENT_APPLICATION_PERIOD_LABELS[period];
  return `${stripped} — ${suffix}`;
}

const uuidAt = (prefix: string, n: number) => prefix + n.toString(16).padStart(4, '0');

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  const db = createDbClient(databaseUrl);

  const plan: Plan = { lines: [], writes: [] };

  for (const target of DIRECT_TARGETS) {
    await planDirect(db, plan, target.instrumentId, target.period, target.name);
  }
  for (const target of SPLIT_TARGETS) {
    await planSplit(db, plan, target);
  }

  console.log('\n══ Plan ══');
  if (plan.lines.length === 0) console.log('  (nada que hacer — ya está todo aplicado)');
  for (const line of plan.lines) console.log(`  ${line}`);

  if (dryRun) {
    console.log(`\n[dry-run] ${plan.writes.length} paso(s) NO ejecutados.`);
    process.exit(0);
  }
  if (plan.writes.length === 0) process.exit(0);

  for (const write of plan.writes) await write(db);
  console.log(`\n✅ ${plan.writes.length} paso(s) aplicados.`);
  console.log('   Siguiente: pnpm --filter @soe/db db:seed:performance-bands');
  process.exit(0);
}

async function planDirect(
  db: Database,
  plan: Plan,
  instrumentId: string,
  period: InstrumentApplicationPeriod,
  forcedName?: string,
): Promise<void> {
  const [inst] = await db
    .select({
      id: instruments.id,
      name: instruments.name,
      applicationPeriod: instruments.applicationPeriod,
    })
    .from(instruments)
    .where(eq(instruments.id, instrumentId));

  if (!inst) {
    plan.lines.push(`· ${instrumentId} — NO existe en esta BDD, se omite`);
    return;
  }
  if (inst.applicationPeriod) {
    plan.lines.push(`· "${inst.name}" — ya tiene momento (${inst.applicationPeriod}), se omite`);
    return;
  }

  const newName = forcedName ?? nameWithPeriod(inst.name, period);
  plan.lines.push(`✎ "${inst.name}" → momento=${period}, nombre="${newName}"`);
  plan.writes.push(async (tx) => {
    await tx
      .update(instruments)
      .set({ applicationPeriod: period, name: newName, updatedAt: new Date() })
      .where(eq(instruments.id, instrumentId));
  });
}

async function planSplit(
  db: Database,
  plan: Plan,
  target: (typeof SPLIT_TARGETS)[number],
): Promise<void> {
  const { instrumentId } = target;
  const [inst] = await db.select().from(instruments).where(eq(instruments.id, instrumentId));
  if (!inst) {
    plan.lines.push(`· ${instrumentId} — NO existe en esta BDD, se omite`);
    return;
  }

  const assessmentRows = await db
    .select({
      id: assessments.id,
      name: assessments.name,
      orgId: assessments.orgId,
      config: assessments.config,
    })
    .from(assessments)
    .where(eq(assessments.instrumentId, instrumentId));

  const byPeriod = new Map<InstrumentApplicationPeriod, typeof assessmentRows>();
  const unresolved: string[] = [];
  for (const a of assessmentRows) {
    const period = periodOfAssessment(a.config, a.name ?? '');
    if (!period) {
      unresolved.push(a.name ?? a.id);
      continue;
    }
    const bucket = byPeriod.get(period) ?? [];
    bucket.push(a);
    byPeriod.set(period, bucket);
  }

  if (unresolved.length > 0) {
    plan.lines.push(
      `⚠️ "${inst.name}" — ${unresolved.length} evaluación(es) sin momento deducible; se ABORTA el split: ${unresolved.join(', ')}`,
    );
    return;
  }
  if (byPeriod.size === 0) {
    plan.lines.push(`· "${inst.name}" — sin evaluaciones, no requiere split`);
    return;
  }

  // El momento mayoritario se queda en el instrumento original: minimiza cuántas
  // evaluaciones/respuestas hay que re-apuntar.
  const [keepPeriod] = [...byPeriod.entries()].sort((a, b) => b[1].length - a[1].length)[0]!;
  const sourceItems = await db
    .select()
    .from(items)
    .where(and(eq(items.instrumentId, instrumentId), isNull(items.deletedAt)))
    .orderBy(items.position);

  if (!inst.applicationPeriod) {
    const newName = nameWithPeriod(inst.name, keepPeriod);
    plan.lines.push(
      `✎ "${inst.name}" (${byPeriod.get(keepPeriod)!.length} evals) → conserva sus ${sourceItems.length} ítems, momento=${keepPeriod}, nombre="${newName}"`,
    );
    plan.writes.push(async (tx) => {
      await tx
        .update(instruments)
        .set({ applicationPeriod: keepPeriod, name: newName, updatedAt: new Date() })
        .where(eq(instruments.id, instrumentId));
    });
  }
  const { restoresBands } = await planStaleBands(
    db,
    plan,
    instrumentId,
    inst.name,
    inst.orgId,
    inst.applicationPeriod ?? keepPeriod,
  );

  for (let i = 0; i < ORDERED_PERIODS.length; i++) {
    const createdId = uuidAt(target.newInstrumentPrefix, 0x20 + i);
    const [created] = await db
      .select({ id: instruments.id, name: instruments.name })
      .from(instruments)
      .where(eq(instruments.id, createdId));
    if (!created) continue;
    await planCopyBands(db, plan, {
      sourceInstrumentId: instrumentId,
      targetInstrumentId: created.id,
      targetInstrumentName: created.name,
      bandIdPrefix: target.newBandPrefix,
      bandIdOffset: (i + 1) * 0x10,
      includePendingRestore: restoresBands,
    });
  }

  const movable = ORDERED_PERIODS.filter((p) => p !== keepPeriod && byPeriod.has(p));
  for (const [idx, period] of movable.entries()) {
    const newInstrumentId = uuidAt(target.newInstrumentPrefix, 0x20 + idx);
    const [already] = await db
      .select({ id: instruments.id })
      .from(instruments)
      .where(eq(instruments.id, newInstrumentId));
    const targetAssessments = byPeriod.get(period)!;
    const newName = nameWithPeriod(inst.name, period);

    if (already) {
      plan.lines.push(`· "${newName}" — ya existe (${newInstrumentId}), no se recrea`);
    } else {
      plan.lines.push(
        `+ "${newName}" (${newInstrumentId}) — instrumento nuevo + ${sourceItems.length} ítems copiados + sus tags`,
      );
      plan.writes.push(async (tx) => {
        await tx.insert(instruments).values({
          ...inst,
          id: newInstrumentId,
          name: newName,
          shortName: inst.shortName ? nameWithPeriod(inst.shortName, period) : null,
          applicationPeriod: period,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        for (const [i, item] of sourceItems.entries()) {
          const newItemId = uuidAt(target.newItemPrefix, (idx + 1) * 0x20 + i);
          await tx.insert(items).values({
            ...item,
            id: newItemId,
            instrumentId: newInstrumentId,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          const tags = await tx
            .select()
            .from(itemTaxonomyTags)
            .where(eq(itemTaxonomyTags.itemId, item.id));
          for (const [t, tag] of tags.entries()) {
            await tx.insert(itemTaxonomyTags).values({
              ...tag,
              id: uuidAt(target.newTagPrefix, (idx + 1) * 0x40 + i * 4 + t),
              itemId: newItemId,
            });
          }
        }
      });
    }

    await planCopyBands(db, plan, {
      sourceInstrumentId: instrumentId,
      targetInstrumentId: newInstrumentId,
      targetInstrumentName: newName,
      bandIdPrefix: target.newBandPrefix,
      bandIdOffset: (idx + 1) * 0x10,
      includePendingRestore: restoresBands,
    });

    const itemIdByPosition = new Map(
      sourceItems.map((item, i) => [item.id, uuidAt(target.newItemPrefix, (idx + 1) * 0x20 + i)]),
    );
    const assessmentIds = targetAssessments.map((a) => a.id);
    const orgIds = [...new Set(targetAssessments.map((a) => a.orgId))];

    const [respCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(responses)
      .where(
        and(
          inArray(responses.assessmentId, assessmentIds),
          inArray(responses.itemId, [...itemIdByPosition.keys()]),
        ),
      );
    const [statsCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(assessmentItemStats)
      .where(
        and(
          inArray(assessmentItemStats.assessmentId, assessmentIds),
          inArray(assessmentItemStats.itemId, [...itemIdByPosition.keys()]),
        ),
      );

    plan.lines.push(
      `→ re-apunta ${assessmentIds.length} evaluación(es) [${targetAssessments.map((a) => a.name ?? a.id).join(', ')}], ` +
        `${respCount?.n ?? 0} responses y ${statsCount?.n ?? 0} item_stats`,
    );
    plan.writes.push(async (tx) => {
      for (const orgId of orgIds) {
        await withOrgContext(tx, orgId, async (otx) => {
          for (const [oldItemId, newItemId] of itemIdByPosition) {
            await otx
              .update(responses)
              .set({ itemId: newItemId })
              .where(
                and(
                  inArray(responses.assessmentId, assessmentIds),
                  eq(responses.itemId, oldItemId),
                ),
              );
            await otx
              .update(assessmentItemStats)
              .set({ itemId: newItemId })
              .where(
                and(
                  inArray(assessmentItemStats.assessmentId, assessmentIds),
                  eq(assessmentItemStats.itemId, oldItemId),
                ),
              );
          }
          await otx
            .update(assessments)
            .set({ instrumentId: newInstrumentId, updatedAt: new Date() })
            .where(and(inArray(assessments.id, assessmentIds), eq(assessments.orgId, orgId)));
        });
      }
    });
  }
}

/**
 * El DIA usa 2 bandas en Diagnóstico y 3 en Monitoreo/Cierre. Si las bandas activas del
 * instrumento no corresponden a su momento real, se soft-deletean para que
 * `db:seed:performance-bands` siembre las correctas. Sólo si NADIE las referencia.
 */
async function planStaleBands(
  db: Database,
  plan: Plan,
  instrumentId: string,
  instrumentName: string,
  instrumentOrgId: string | null,
  period: InstrumentApplicationPeriod,
): Promise<{ restoresBands: boolean }> {
  const bands = await db
    .select({ id: performanceBands.id, label: performanceBands.label })
    .from(performanceBands)
    .where(
      and(
        eq(performanceBands.instrumentId, instrumentId),
        isNull(performanceBands.orgId),
        isNull(performanceBands.deletedAt),
      ),
    );

  if (bands.length === 0 && instrumentOrgId !== null) {
    const orphaned = await db
      .select({ id: performanceBands.id, label: performanceBands.label })
      .from(performanceBands)
      .where(
        and(
          eq(performanceBands.instrumentId, instrumentId),
          isNull(performanceBands.orgId),
          sql`${performanceBands.deletedAt} is not null`,
        ),
      );
    if (orphaned.length > 0) {
      const ids = orphaned.map((b) => b.id);
      plan.lines.push(
        `♻︎ "${instrumentName}" quedó sin bandas activas y es de org (el seed no lo cubre): RESTAURA ${orphaned.length} banda(s) [${orphaned.map((b) => b.label).join(', ')}]`,
      );
      plan.writes.push(async (tx) => {
        await tx
          .update(performanceBands)
          .set({ deletedAt: null })
          .where(inArray(performanceBands.id, ids));
      });
      return { restoresBands: true };
    }
    return { restoresBands: false };
  }

  const expected = period === 'diagnostico' ? 2 : 3;
  if (bands.length === 0 || bands.length === expected) return { restoresBands: false };

  if (instrumentOrgId !== null) {
    plan.lines.push(
      `· "${instrumentName}" tiene ${bands.length} banda(s) y ${period} usa ${expected}, pero es de org y \`db:seed:performance-bands\` no lo cubre: NO se tocan (corregir por PUT /instruments/:id/performance-bands)`,
    );
    return { restoresBands: false };
  }

  const bandIds = bands.map((b) => b.id);
  const [usedInResults] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(assessmentResults)
    .where(inArray(assessmentResults.performanceBandId, bandIds));
  const [usedInSkills] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(skillResults)
    .where(inArray(skillResults.performanceBandId, bandIds));
  const used = (usedInResults?.n ?? 0) + (usedInSkills?.n ?? 0);

  if (used > 0) {
    plan.lines.push(
      `⚠️ ${bands.length} banda(s) no corresponden a ${period} (se esperan ${expected}) pero están usadas en ${used} resultado(s): NO se tocan, revisar a mano`,
    );
    return { restoresBands: false };
  }

  plan.lines.push(
    `✎ soft-delete de ${bands.length} banda(s) obsoletas [${bands.map((b) => b.label).join(', ')}] — ${period} usa ${expected}; 0 usos en resultados`,
  );
  plan.writes.push(async (tx) => {
    await tx
      .update(performanceBands)
      .set({ deletedAt: new Date() })
      .where(inArray(performanceBands.id, bandIds));
  });
  return { restoresBands: false };
}

/**
 * Copia las bandas activas del instrumento original al nuevo. Paso aparte de la
 * creación (y no dentro de ella) para que también repare un instrumento creado por
 * una corrida anterior que quedó sin bandas: sin ellas, sus evaluaciones pierden el
 * corte que tenían y el scoring cae al enum legacy 40/70/85.
 */
async function planCopyBands(
  db: Database,
  plan: Plan,
  args: {
    sourceInstrumentId: string;
    targetInstrumentId: string;
    targetInstrumentName: string;
    bandIdPrefix: string;
    bandIdOffset: number;
    includePendingRestore: boolean;
  },
): Promise<void> {
  const existing = await db
    .select({ id: performanceBands.id })
    .from(performanceBands)
    .where(
      and(
        eq(performanceBands.instrumentId, args.targetInstrumentId),
        isNull(performanceBands.deletedAt),
      ),
    );
  if (existing.length > 0) return;

  // Si el plan incluye restaurar las bandas del original (soft-deleteadas por una
  // corrida anterior), hay que copiarlas igual: ese write corre ANTES que este.
  const sourceBands = await db
    .select()
    .from(performanceBands)
    .where(
      args.includePendingRestore
        ? eq(performanceBands.instrumentId, args.sourceInstrumentId)
        : and(
            eq(performanceBands.instrumentId, args.sourceInstrumentId),
            isNull(performanceBands.deletedAt),
          ),
    );
  if (sourceBands.length === 0) {
    plan.lines.push(
      `⚠️ "${args.targetInstrumentName}" queda SIN bandas: el instrumento original tampoco tiene activas`,
    );
    return;
  }

  plan.lines.push(
    `+ "${args.targetInstrumentName}" — copia ${sourceBands.length} banda(s) del original [${sourceBands.map((b) => b.label).join(', ')}]`,
  );
  plan.writes.push(async (tx) => {
    for (const [b, band] of sourceBands.entries()) {
      await tx.insert(performanceBands).values({
        ...band,
        id: uuidAt(args.bandIdPrefix, args.bandIdOffset + b),
        instrumentId: args.targetInstrumentId,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
  });
}

main().catch((err) => {
  console.error('Corrección de application_period falló:', err);
  process.exit(1);
});
