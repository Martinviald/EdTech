import 'server-only';
import { cache } from 'react';
import { eq } from 'drizzle-orm';
import { schema } from '@soe/db';
import { db } from '@/lib/db';

export const getCurrentOrg = cache(async (orgId: string) => {
  const [org] = await db
    .select({
      id: schema.organizations.id,
      name: schema.organizations.name,
      type: schema.organizations.type,
    })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, orgId))
    .limit(1);
  if (!org) throw new Error(`Organization ${orgId} not found`);
  return org;
});

export type CurrentOrg = Awaited<ReturnType<typeof getCurrentOrg>>;
