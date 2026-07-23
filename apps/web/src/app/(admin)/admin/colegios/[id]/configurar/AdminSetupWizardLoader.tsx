'use client';

import { SetupWizard } from '@/app/(dashboard)/organizacion/configurar/SetupWizard';
import type {
  Grade,
  Organization,
  Subject,
} from '@/app/(dashboard)/organizacion/configurar/types';
import type { AcademicSetupDto, UpdateOrganizationProfileDto } from '@soe/types';
import { ROUTES } from '@/lib/routes';

type Props = {
  orgId: string;
  org: Organization;
  grades: Grade[];
  subjects: Subject[];
  updateAction: (dto: UpdateOrganizationProfileDto) => Promise<void>;
  setupAction: (dto: AcademicSetupDto) => Promise<unknown>;
};

/**
 * Wrapper cliente que monta SetupWizard con acciones admin (acotadas al orgId
 * del path) en lugar de las acciones del dashboard (que toman orgId del JWT).
 */
export function AdminSetupWizardLoader({
  orgId,
  org,
  grades,
  subjects,
  updateAction,
  setupAction,
}: Props) {
  return (
    <SetupWizard
      org={org}
      grades={grades}
      subjects={subjects}
      actions={{
        updateOrgProfile: updateAction,
        setupAcademicYear: setupAction,
      }}
      successRedirect={ROUTES.adminColegio(orgId)}
    />
  );
}
