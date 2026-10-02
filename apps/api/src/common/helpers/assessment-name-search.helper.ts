import { sql, type SQL } from 'drizzle-orm';
import { assessments, instruments } from '@soe/db';
import { buildContainsPattern } from '@soe/types';

export function assessmentNameMatches(term: string): SQL {
  const pattern = buildContainsPattern(term);
  return sql`(public.unaccent(${assessments.name}) ilike public.unaccent(${pattern}) or public.unaccent(${instruments.name}) ilike public.unaccent(${pattern}))`;
}
