import { sql } from 'drizzle-orm';
import type { Database } from './client';

/**
 * Envuelve una operación en una transacción que fija `app.current_org_id`
 * para las políticas RLS de PostgreSQL. El `set_config(..., true)` es
 * transaction-scoped: se resetea automáticamente al terminar la transacción,
 * lo que lo hace seguro con connection pooling.
 *
 * Todo Service que consulte tablas con RLS activo (students, assessments,
 * import_jobs, responses, assessment_results, skill_results) debe envolver
 * sus queries con este wrapper.
 */
export async function withOrgContext<T>(
  db: Database,
  orgId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    return fn(tx as unknown as Database);
  });
}
