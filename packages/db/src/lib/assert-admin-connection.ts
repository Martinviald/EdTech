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
 * La comprobación es por CAPACIDAD, no por atributos del rol. Mirar
 * `rolbypassrls`/`rolsuper` da un falso positivo contra demo: `soe_admin` tiene los dos
 * en `false` y ninguno de sus roles heredados los trae, pero es OWNER de las tablas y
 * miembro de `pg_read_all_data`/`pg_write_all_data`, así que ve las filas de todas las
 * orgs sin contexto — que es justo la capacidad que hace falta. `row_security_active()`
 * responde la pregunta real: ¿me aplican las políticas de esta tabla?
 *
 * El rol correcto es el de `DATABASE_ADMIN_URL`; ver `packages/db/sql/roles.sql`.
 */
export async function assertAdminConnection(db: Database, scriptName: string): Promise<void> {
  const rows = (await db.execute(sql`
    SELECT
      current_user AS role,
      coalesce(bool_or(row_security_active(c.oid)), false) AS filtered_by_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relrowsecurity AND c.relkind = 'r'
  `)) as unknown as Array<{ role: string; filtered_by_rls: boolean }>;

  const info = rows[0];
  if (!info) {
    throw new Error(
      `${scriptName}: no se pudo verificar el rol de conexión. Corre con DATABASE_ADMIN_URL.`,
    );
  }

  if (info.filtered_by_rls) {
    throw new Error(
      `${scriptName}: las políticas RLS se aplican al rol "${info.role}", así que este script ` +
        `no vería ni escribiría las filas de otras orgs y reportaría éxito sin hacer nada. ` +
        `Vuelve a correrlo con DATABASE_ADMIN_URL (rol privilegiado); ` +
        `ver packages/db/sql/roles.sql.`,
    );
  }
}
