import { cache } from 'react';

import { apiGet } from '@/lib/api';

export type OrgOverview = {
  org: {
    id: string;
    name: string;
    rbd: string | null;
    commune: string | null;
    region: string | null;
    dependence: string | null;
  };
  academicYear: { id: string; year: number } | null;
  classGroupCount: number;
  isSetupComplete: boolean;
};

export const getOrgOverview = cache(() =>
  apiGet<OrgOverview>('/organizations/me/overview'),
);
