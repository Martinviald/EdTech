import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { CalendarRange, Plus } from 'lucide-react';
import { auth } from '@/auth';
import {
  canAccess,
  PROCESS_MANAGEMENT_ROLES,
  PROCESS_VIEWER_ROLES,
  type MeasurementProcessModel,
} from '@soe/types';
import { CardSkeleton, EmptyState, PageContainer, PageHeader } from '@/components/shared';
import { ROUTES } from '@/lib/routes';
import { Button } from '@/components/ui/button';
import { getProcesses, getScopeCatalog } from './data';
import { ProcessCard } from './components/process-card';
import { ProcessFormDialog } from './components/process-form-dialog';

export const dynamic = 'force-dynamic';

export default async function ProcesosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, PROCESS_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const canManage = canAccess(session.user.roles, PROCESS_MANAGEMENT_ROLES);
  const params = await searchParams;
  const academicYearId = typeof params.academicYearId === 'string' ? params.academicYearId : null;
  const query = academicYearId ? `?academicYearId=${academicYearId}` : '';

  return (
    <PageContainer>
      <PageHeader
        title="Procesos de medición"
        description="Cada ventana de aplicación —un momento DIA, una toma de ensayo, una evaluación semestral— con su rendición, sus resultados y sus accesos directos."
        icon={CalendarRange}
        actions={
          canManage ? (
            <Suspense fallback={null}>
              <NewProcessAction />
            </Suspense>
          ) : null
        }
      />
      <Suspense key={query} fallback={<ProcessListSkeleton />}>
        <ProcessList query={query} />
      </Suspense>
    </PageContainer>
  );
}

async function NewProcessAction() {
  const catalog = await getScopeCatalog();
  if (catalog.periods.length === 0) return null;

  return (
    <ProcessFormDialog
      academicYears={catalog.periods}
      trigger={
        <Button>
          <Plus className="mr-2 size-4" aria-hidden />
          Nuevo proceso
        </Button>
      }
    />
  );
}

async function ProcessList({ query }: { query: string }) {
  const { data, total } = await getProcesses(query);

  if (total === 0) {
    return (
      <EmptyState
        icon={CalendarRange}
        title="Todavía no hay procesos de medición"
        description="Un proceso agrupa las evaluaciones de una misma ventana de aplicación. Al crearlo puedes seguir su rendición y abrir sus resultados desde un solo lugar."
      />
    );
  }

  const byYear = new Map<number | null, MeasurementProcessModel[]>();
  for (const process of data) {
    const bucket = byYear.get(process.academicYear);
    if (bucket) bucket.push(process);
    else byYear.set(process.academicYear, [process]);
  }

  return (
    <div className="space-y-8">
      {data.length < total && (
        <p className="text-muted-foreground text-sm">
          Mostrando {data.length} de {total} procesos.
        </p>
      )}
      {Array.from(byYear.entries()).map(([year, processes]) => (
        <section key={year ?? 'sin-anio'} className="space-y-3">
          <h2 className="text-muted-foreground text-sm font-medium">
            {year ?? 'Sin año académico'}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {processes.map((process) => (
              <ProcessCard key={process.id} process={process} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ProcessListSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <CardSkeleton rows={3} />
      <CardSkeleton rows={3} />
      <CardSkeleton rows={3} />
    </div>
  );
}
