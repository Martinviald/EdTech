import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof createDbClient>;

export type DbClientOptions = {
  /**
   * Tamaño del pool. El default 10 es el de la API y no debe cambiarse a la ligera.
   * Lo pide explícito el backfill de cohort-stats, que corre N evaluaciones en
   * paralelo y necesita `concurrencia + margen` conexiones para no serializarse
   * esperando el pool.
   */
  maxConnections?: number;
};

export function createDbClient(databaseUrl: string, options: DbClientOptions = {}) {
  const queryClient = postgres(databaseUrl, {
    max: options.maxConnections ?? 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return drizzle(queryClient, { schema, logger: process.env.NODE_ENV !== 'production' });
}
