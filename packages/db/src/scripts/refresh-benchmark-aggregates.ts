/**
 * Refresh del read-model de benchmarking (`benchmark_aggregates`).
 *
 *   DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db db:refresh:benchmark
 *   ... --org <orgId>     # sólo una organización
 *
 * Idempotente (upsert por org × instrumento × nivel × asignatura): correrlo dos veces
 * deja el mismo estado. Lo corren el deploy de backend y el job programado
 * (.github/workflows/deploy.yml y refresh-benchmark.yml); antes sólo existía
 * el endpoint `POST /api/benchmarking/refresh` y el read-model quedaba congelado en
 * lo que sembró `seed/benchmark-demo.ts`. Ver `queries/benchmark-aggregates.ts`.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '../../../../.env') });

import { createDbClient } from '../client';
import { refreshBenchmarkAggregates } from '../queries/benchmark-aggregates';

function parseOrgId(argv: readonly string[]): string | undefined {
  const index = argv.indexOf('--org');
  if (index === -1) return undefined;
  const orgId = argv[index + 1];
  if (!orgId) throw new Error('--org requiere un orgId');
  return orgId;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Falta DATABASE_ADMIN_URL (o DATABASE_URL) en el entorno');
  }

  const orgId = parseOrgId(process.argv.slice(2));
  const db = createDbClient(databaseUrl, { maxConnections: 2 });
  try {
    const started = Date.now();
    const { refreshedOrgs, refreshedRows, refreshedItemRows } = await refreshBenchmarkAggregates(
      db,
      { orgId },
    );
    console.log(
      `[refresh-benchmark] ${refreshedOrgs} orgs, ${refreshedRows} filas, ${refreshedItemRows} ítems en ${Date.now() - started} ms`,
    );
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error('[refresh-benchmark] falló:', err);
  process.exit(1);
});
