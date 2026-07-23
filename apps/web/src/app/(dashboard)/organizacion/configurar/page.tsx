import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { CardSkeleton } from '@/components/shared';
import { ROUTES } from '@/lib/routes';
import { SetupWizard } from './SetupWizard';
import type { Grade, Organization, Subject } from './types';

export default async function ConfigurarColegioPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect(ROUTES.login);

  const { role } = session.user;
  if (!['school_admin', 'platform_admin'].includes(role)) {
    redirect(ROUTES.dashboard);
  }

  const { isSetupComplete } = await apiGet<{ isSetupComplete: boolean }>('/organizations/me/overview');
  if (isSetupComplete) redirect(ROUTES.organizacion);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Configurar colegio</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Completa la información de tu institución para el año académico {new Date().getFullYear()}.
        </p>
      </div>
      <Suspense fallback={<CardSkeleton rows={5} />}>
        <SetupWizardSection />
      </Suspense>
    </div>
  );
}

async function SetupWizardSection() {
  const [org, grades, subjects] = await Promise.all([
    apiGet<Organization>('/organizations/me'),
    apiGet<Grade[]>('/organizations/grades'),
    apiGet<Subject[]>('/organizations/subjects'),
  ]);

  return <SetupWizard org={org} grades={grades} subjects={subjects} />;
}
