import { sql } from 'drizzle-orm';
import type { Database } from './client';

/**
 * Contexto RLS para el canje de una sesión de captura remota (E22-R, CD-18).
 *
 * El canje ocurre en una ruta pública, ANTES de conocer la org, así que
 * `withOrgContext` no aplica. La política `capture_sessions_redeem_by_id`
 * (packages/db/sql/rls-policies.sql) permite leer EXACTAMENTE la fila cuyo id
 * viaja en `app.capture_session_id` — sólo SELECT, sólo esa fila. Con el
 * `org_id` leído de ella, todo lo que sigue vuelve a `withOrgContext`.
 */
export async function withCaptureSessionContext<T>(
  db: Database,
  sessionId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.capture_session_id', ${sessionId}, true)`);
    return fn(tx as unknown as Database);
  });
}
