import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { getOrg } from '@/lib/adminApi';
import type {
  Grade,
  Subject,
} from '@/app/(dashboard)/organizacion/configurar/types';
import {
  adminSetupAcademicYearAction,
  adminUpdateOrgProfileAction,
} from './actions';
import { AdminSetupWizardLoader } from './AdminSetupWizardLoader';
import { ROUTES } from '@/lib/routes';

export const dynamic = 'force-dynamic';

export default async function AdminConfigurarPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [org, grades, subjects] = await Promise.all([
    getOrg(id),
    apiGet<Grade[]>('/organizations/grades'),
    apiGet<Subject[]>('/organizations/subjects'),
  ]);

  if (org.type !== 'school') {
    redirect(ROUTES.adminColegio(id));
  }

  // `.bind` produce nuevas referencias de Server Action atadas al orgId del path.
  const updateAction = adminUpdateOrgProfileAction.bind(null, id);
  const setupAction = adminSetupAcademicYearAction.bind(null, id);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={ROUTES.adminColegio(id)}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {org.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Configurar año académico</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Estás configurando el colegio <strong>{org.name}</strong> como platform admin. Al
          completar, el colegio quedará listo para operar.
        </p>
      </div>

      <AdminSetupWizardLoader
        orgId={id}
        org={{
          id: org.id,
          name: org.name,
          type: org.type,
          rbd: org.rbd,
          commune: org.commune,
          region: org.region,
          dependence: org.dependence,
        }}
        grades={grades}
        subjects={subjects}
        updateAction={updateAction}
        setupAction={setupAction}
      />
    </div>
  );
}
