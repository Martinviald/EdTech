import { sql } from 'drizzle-orm';
import type { Database } from '../client';

/**
 * Exige que el script corra con un rol que BYPASSA RLS, y aborta si no.
 *
 * Espejo de `checkRlsEnforcement` de la API, con la polaridad invertida: ahí un rol
 * privilegiado es el problema (volvería el RLS un no-op), acá es el requisito.
 *
 * Los scripts de mantenimiento escriben sobre tablas con RLS y `FORCE ROW LEVEL
 * SECURITY` (`assessments`, `measurement_processes`, `test_tracks`) sin abrir
 * `withOrgContext`, porque operan sobre varias orgs a la vez. Con `DATABASE_URL`
 * (rol `soe_app`, sujeto a RLS) no fallan: los SELECT devuelven 0 filas y los UPDATE
 * afectan 0, así que el script informa "no hay nada que hacer" y termina con éxito.
 * Indistinguible de "ya estaba hecho" — y el operador sigue al paso siguiente del
 * runbook creyendo que escribió. De ahí que esto sea un error y no un warning.
 *
 * El rol correcto es el de `DATABASE_ADMIN_URL`; ver `packages/db/sql/roles.sql`.
 */
export async function assertAdminConnection(db: Database, scriptName: string): Promise<void> {
  const rows = (await db.execute(sql`
    SELECT
      current_user AS role,
      current_setting('is_superuser') = 'on' AS is_superuser,
      (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass_rls
  `)) as unknown as Array<{ role: string; is_superuser: boolean; bypass_rls: boolean }>;

  const info = rows[0];
  if (!info) {
    throw new Error(
      `${scriptName}: no se pudo verificar el rol de conexión. Corre con DATABASE_ADMIN_URL.`,
    );
  }

  if (!info.is_superuser && !info.bypass_rls) {
    throw new Error(
      `${scriptName}: el rol "${info.role}" está sujeto a RLS, así que este script no vería ` +
        `ni escribiría las filas de otras orgs y reportaría éxito sin hacer nada. ` +
        `Vuelve a correrlo con DATABASE_ADMIN_URL (rol privilegiado); ` +
        `ver packages/db/sql/roles.sql.`,
    );
  }
}
