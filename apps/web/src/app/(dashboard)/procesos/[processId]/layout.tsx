import type { ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { BarChart3, CalendarRange } from 'lucide-react';
import { auth } from '@/auth';
import {
  canAccess,
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  PROCESS_KIND_LABELS,
  PROCESS_VIEWER_ROLES,
  type MeasurementProcessModel,
} from '@soe/types';
import { PageContainer, PageHeader, PageTabs, type PageTab } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { ROUTES } from '@/lib/routes';
import { getProcess } from '../data';
import { ProcessStatusBadge } from '../components/process-status-badge';

export default async function ProcesoLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ processId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, PROCESS_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const { processId } = await params;
  let process: MeasurementProcessModel | null = null;
  try {
    process = await getProcess(processId);
  } catch {
    notFound();
  }
  if (!process) notFound();

  const base = ROUTES.proceso(process.id);
  const tabs: PageTab[] = [
    { href: base, label: 'Resumen', exact: true },
    { href: ROUTES.procesoRendicion(process.id), label: 'Rendición' },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={process.name}
        description={describeProcess(process)}
        icon={CalendarRange}
        breadcrumb={
          <nav className="text-muted-foreground flex items-center gap-2 text-sm">
            <Link href={ROUTES.procesos} className="hover:text-foreground">
              Procesos de medición
            </Link>
            <span aria-hidden>/</span>
            <span>{process.name}</span>
          </nav>
        }
        badges={<ProcessStatusBadge status={process.status} />}
        actions={
          <Button asChild variant="outline">
            <Link href={`${ROUTES.resultados}?processId=${process.id}`}>
              <BarChart3 className="mr-2 size-4" aria-hidden />
              Ver panorama
            </Link>
          </Button>
        }
      />
      <PageTabs tabs={tabs} />
      {children}
    </PageContainer>
  );
}

function describeProcess(process: MeasurementProcessModel): string {
  return [
    PROCESS_KIND_LABELS[process.kind],
    process.period ? INSTRUMENT_APPLICATION_PERIOD_LABELS[process.period] : null,
    process.academicYear ? `Año ${process.academicYear}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
