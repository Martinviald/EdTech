/**
 * Backfill de `instruments.application_period` para los instrumentos que lo tienen
 * en NULL.
 *
 *   DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db db:backfill:application-period
 *   ... --dry-run                # reporta lo que haría, no escribe
 *
 * Por qué existe: el filtro de "Momento" de /resultados es
 * `instruments.application_period` (dashboards.service → resolveScopedAssessmentIds).
 * Un instrumento sin momento no aparece bajo NINGÚN valor del filtro, aunque el
 * nombre de sus evaluaciones diga "Diagnóstico". La columna se agregó en la
 * migración 0011 con un backfill desde `version`/`config`, que no alcanzó a los
 * instrumentos que no traían ninguno de los dos.
 *
 * El momento se deduce del NOMBRE (`inferApplicationPeriodFromName`, en
 * `@soe/types`) — la misma fuente que ya usaba `seedPerformanceBands`. Los que el
 * nombre no permite clasificar se dejan en NULL y se listan al final: adivinarlos
 * sería peor que no tenerlos, porque el momento define claves y bandas de logro.
 *
 * Idempotente: sólo toca filas con `application_period IS NULL`. Correrlo dos
 * veces no cambia nada la segunda vez.
 *
 * ⚠️ No arregla el caso de fondo — un instrumento COMPARTIDO por evaluaciones de
 * varios momentos no tiene un momento que deducir. Eso se corrige separándolo en
 * un instrumento por aplicación (ver el seed E2E, §8), no acá.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '../../../../.env') });

import { eq, isNull } from 'drizzle-orm';
import { inferApplicationPeriodFromName } from '@soe/types';
import { createDbClient } from '../client';
import { instruments } from '../schema/instruments';

function parseArgs(argv: readonly string[]): { dryRun: boolean } {
  return { dryRun: argv.includes('--dry-run') };
}

async function main(): Promise<void> {
  const { dryRun } = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_ADMIN_URL o DATABASE_URL es requerido');
  const db = createDbClient(databaseUrl);

  const pending = await db
    .select({ id: instruments.id, name: instruments.name, type: instruments.type })
    .from(instruments)
    .where(isNull(instruments.applicationPeriod));

  if (pending.length === 0) {
    console.log('✅ No hay instrumentos con application_period en NULL.');
    process.exit(0);
  }

  const unresolved: Array<{ id: string; name: string }> = [];
  let updated = 0;

  for (const inst of pending) {
    const period = inferApplicationPeriodFromName(inst.name);
    if (!period) {
      unresolved.push({ id: inst.id, name: inst.name });
      continue;
    }
    console.log(`${dryRun ? '· [dry-run]' : '✓'} ${inst.name} → ${period}`);
    if (!dryRun) {
      await db
        .update(instruments)
        .set({ applicationPeriod: period, updatedAt: new Date() })
        .where(eq(instruments.id, inst.id));
    }
    updated += 1;
  }

  console.log(
    `\n${dryRun ? 'Se actualizarían' : 'Actualizados'} ${updated} de ${pending.length} instrumento(s).`,
  );

  if (unresolved.length > 0) {
    console.log(
      `\n⚠️ ${unresolved.length} instrumento(s) quedan sin momento (el nombre no lo dice).`,
    );
    console.log(
      '   Si alguno es un instrumento compartido entre varios momentos, la corrección es',
    );
    console.log('   separarlo en un instrumento por aplicación, no forzarle un momento:');
    for (const inst of unresolved) console.log(`   · ${inst.name} (${inst.id})`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill de application_period falló:', err);
  process.exit(1);
});
