import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Database } from '@soe/db';

/**
 * Self-check de arranque del aislamiento multi-tenant (RLS).
 *
 * Las políticas RLS solo filtran si la API conecta con un rol que NO bypassa RLS.
 * Los superusers y los roles con BYPASSRLS bypassan SIEMPRE las políticas, lo que
 * convertiría el RLS en un no-op silencioso (justo lo que pasó antes — ver
 * docs/Sprints/H19.4). Este check emite un warning visible si la conexión de la
 * API no está sujeta a RLS, para que nunca vuelva a fallar sin que nadie lo note.
 */
export async function checkRlsEnforcement(db: Database): Promise<void> {
  const logger = new Logger('RLS');
  try {
    const rows = (await db.execute(sql`
      SELECT
        current_user AS role,
        current_setting('is_superuser') = 'on' AS is_superuser,
        (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass_rls
    `)) as unknown as Array<{ role: string; is_superuser: boolean; bypass_rls: boolean }>;

    const info = rows[0];
    if (!info) {
      logger.warn('No se pudo verificar el rol de conexión para RLS.');
      return;
    }

    if (info.is_superuser || info.bypass_rls) {
      logger.warn(
        `⚠️  La API está conectada con el rol "${info.role}" que BYPASSA RLS ` +
          `(superuser=${info.is_superuser}, bypassrls=${info.bypass_rls}). ` +
          `El aislamiento multi-tenant NO se está aplicando. En producción la API ` +
          `debe usar un rol no-privilegiado (ej. soe_app); ver packages/db/sql/roles.sql.`,
      );
    } else {
      logger.log(`Aislamiento RLS activo — conexión vía rol "${info.role}" (sujeto a RLS).`);
    }
  } catch (err) {
    logger.warn(`No se pudo ejecutar el self-check de RLS: ${String(err)}`);
  }
}
