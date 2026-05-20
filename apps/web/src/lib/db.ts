import { createDbClient, type Database } from '@soe/db';

declare global {
  // eslint-disable-next-line no-var
  var __soeDb: Database | undefined;
}

function buildClient(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  return createDbClient(url);
}

export const db: Database = global.__soeDb ?? buildClient();

if (process.env.NODE_ENV !== 'production') {
  global.__soeDb = db;
}
