import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof createDbClient>;

export function createDbClient(databaseUrl: string) {
  const queryClient = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

  return drizzle(queryClient, { schema, logger: process.env.NODE_ENV !== 'production' });
}
