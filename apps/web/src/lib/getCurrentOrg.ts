import 'server-only';
import { cache } from 'react';
import { apiGet } from '@/lib/api';

type OrgProfile = {
  id: string;
  name: string;
  type: string;
  rbd: string | null;
  commune: string | null;
  region: string | null;
  dependence: string | null;
};

export const getCurrentOrg = cache(async (_orgId: string) => {
  return apiGet<OrgProfile>('/organizations/me');
});

export type CurrentOrg = Awaited<ReturnType<typeof getCurrentOrg>>;
