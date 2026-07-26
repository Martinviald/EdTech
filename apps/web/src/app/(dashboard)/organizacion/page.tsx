import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import { AlertCallout, PageContainer } from '@/components/shared';

import { OrgHubHeader } from './components/OrgHubHeader';
import { getOrgOverview } from './overview';

const DEPENDENCE_LABELS: Record<string, string> = {
  municipal: 'Municipal',
  particular_pagado: 'Particular Pagado',
  particular_subvencionado: 'Particular Subvencionado',
  delegada: 'Corporación Delegada',
};

export default async function OrganizacionPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect(ROUTES.login);

  const { org, academicYear, classGroupCount, isSetupComplete } =
    await getOrgOverview();
  const currentYear = new Date().getFullYear();

  return (
    <PageContainer>
      <OrgHubHeader />

      {!isSetupComplete ? (
        <AlertCallout tone="warning">
          La configuración del año académico {currentYear} aún no está completa. Ingresa los
          ciclos, cursos y asignaturas para comenzar a usar la plataforma.
        </AlertCallout>
      ) : null}

      <div className="space-y-8">
        <InfoSection title="Información básica">
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <InfoItem label="RBD" value={org.rbd ?? '—'} />
            <InfoItem
              label="Dependencia"
              value={
                org.dependence
                  ? (DEPENDENCE_LABELS[org.dependence] ?? org.dependence)
                  : '—'
              }
            />
            <InfoItem label="Comuna" value={org.commune ?? '—'} />
            <InfoItem label="Región" value={org.region ?? '—'} />
          </dl>
        </InfoSection>

        <InfoSection title={`Año académico ${academicYear?.year ?? currentYear}`}>
          {isSetupComplete ? (
            <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              <InfoItem label="Cursos configurados" value={String(classGroupCount)} />
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">Sin configurar</p>
          )}
        </InfoSection>
      </div>
    </PageContainer>
  );
}

function InfoSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t pt-6 first:border-t-0 first:pt-0">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}
