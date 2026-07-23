import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import { apiGet } from '@/lib/api';
import type { InstrumentModel, ItemModel } from '@soe/types';
import { SpecTableView } from '@/app/(dashboard)/banco-items/[instrumentId]/spec-table/SpecTableView';
import { ROUTES } from '@/lib/routes';
import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer, TableSkeleton } from '@/components/shared';

type ItemsListResponse = {
  data: ItemModel[];
  total: number;
  page: number;
  limit: number;
};

type PageProps = {
  params: Promise<{ instrumentId: string }>;
};

/**
 * Backoffice de plataforma — tabla de especificaciones (solo lectura) de un
 * instrumento OFICIAL. El `(admin)/layout.tsx` ya exige `isPlatformAdmin`. Reusa
 * `SpecTableView` con `basePath="/admin/instrumentos"` y `canEdit={false}`: el
 * flujo de carga/edición vive en el dashboard del colegio (igual que la vista de
 * detalle usa `showAuthoringLinks={false}`).
 */
export default async function AdminSpecTablePage({ params }: PageProps) {
  const { instrumentId } = await params;

  return (
    <Suspense fallback={<SpecTableFallback />}>
      <SpecTableSection instrumentId={instrumentId} />
    </Suspense>
  );
}

function SpecTableFallback() {
  return (
    <PageContainer>
      <Skeleton className="h-4 w-48" />
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <TableSkeleton rows={8} />
    </PageContainer>
  );
}

async function SpecTableSection({ instrumentId }: { instrumentId: string }) {
  let instrument: InstrumentModel;
  try {
    instrument = await apiGet<InstrumentModel>(`/instruments/${instrumentId}`);
  } catch {
    notFound();
  }

  // Este backoffice es sólo para instrumentos oficiales.
  if (!instrument.isOfficial) redirect(ROUTES.adminInstrumentos);

  const itemsResponse = await apiGet<ItemsListResponse>(
    `/items?instrumentId=${instrumentId}&limit=200`,
  );

  return (
    <SpecTableView
      instrument={instrument}
      items={itemsResponse.data ?? []}
      canEdit={false}
      basePath={ROUTES.adminInstrumentos}
      breadcrumb={{ href: ROUTES.adminInstrumentos, label: 'Instrumentos oficiales' }}
    />
  );
}
