import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { SetupWizard } from './SetupWizard';
import type { Grade, Organization, Subject } from './types';

export default async function ConfigurarColegioPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect('/login');

  const { role } = session.user;
  if (!['school_admin', 'platform_admin'].includes(role)) {
    redirect('/dashboard');
  }

  const [org, grades, subjects] = await Promise.all([
    apiGet<Organization>('/organizations/me'),
    apiGet<Grade[]>('/organizations/grades'),
    apiGet<Subject[]>('/organizations/subjects'),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Configurar colegio</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Completa la información de tu institución para el año académico {new Date().getFullYear()}.
        </p>
      </div>
      <SetupWizard org={org} grades={grades} subjects={subjects} />
    </div>
  );
}
