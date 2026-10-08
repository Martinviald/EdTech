/**
 * Rellena el tally (`score_sum` / `max_sum`, y el de cada habilidad de `per_skill`) de las filas
 * del fixture de benchmarking que se sembraron antes de que existiera el tally.
 *
 *   DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db db:backfill:benchmark-demo-tallies [--dry-run]
 *
 * La muestra se arma sumando tallies (docs/diseno-logro-unificado-y-cohorte.md §3.1): una fila
 * con `max_sum = 0` no aporta y la muestra del fixture queda vacía. Volver a correr
 * `db:seed:benchmark` no sirve en una BDD con datos, porque el seed borra y recrea las orgs
 * de su namespace (entre ellas Colegio Andes Centro, con sus evaluaciones). Este script solo
 * actualiza las filas de los dos instrumentos del fixture que no tienen tally, con la misma
 * regla del seed. Es idempotente: una fila que ya tiene tally no se toca.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { and, eq, inArray } from 'drizzle-orm';
import { createDbClient } from '../client';
import { benchmarkAggregates } from '../schema/benchmark';
import {
  DEMO_INSTRUMENT_IDS,
  demoInstrumentTally,
  withDemoSkillTally,
} from '../seed/benchmark-demo-fixture';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Falta DATABASE_ADMIN_URL (o DATABASE_URL) en el entorno');

  const db = createDbClient(databaseUrl, { maxConnections: 1 });
  try {
    const rows = await db
      .select({
        id: benchmarkAggregates.id,
        studentCount: benchmarkAggregates.studentCount,
        avgAchievement: benchmarkAggregates.avgAchievement,
        perSkill: benchmarkAggregates.perSkill,
      })
      .from(benchmarkAggregates)
      .where(
        and(
          inArray(benchmarkAggregates.instrumentId, [...DEMO_INSTRUMENT_IDS]),
          eq(benchmarkAggregates.maxSum, '0'),
        ),
      );

    let updated = 0;
    let skipped = 0;
    for (const row of rows) {
      if (row.avgAchievement === null || row.studentCount <= 0) {
        skipped += 1;
        continue;
      }
      const tally = demoInstrumentTally(row.studentCount, Number(row.avgAchievement));
      const perSkill = row.perSkill?.map(withDemoSkillTally) ?? null;
      if (!dryRun) {
        await db
          .update(benchmarkAggregates)
          .set({
            scoreSum: tally.scoreSum.toFixed(2),
            maxSum: tally.maxSum.toFixed(2),
            perSkill,
            updatedAt: new Date(),
          })
          .where(eq(benchmarkAggregates.id, row.id));
      }
      updated += 1;
    }

    console.log(
      `[benchmark-demo-tallies] ${dryRun ? '(dry-run) ' : ''}${updated} fila(s) del fixture ` +
        `con tally rellenado, ${skipped} sin % que no se pueden rellenar.`,
    );
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error('[benchmark-demo-tallies] falló:', err);
  process.exit(1);
});
