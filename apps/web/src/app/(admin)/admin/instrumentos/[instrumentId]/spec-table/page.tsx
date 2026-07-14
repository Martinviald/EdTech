import { notFound, redirect } from 'next/navigation';
import { apiGet } from '@/lib/api';
import type { InstrumentModel, ItemModel } from '@soe/types';
import { SpecTableView } from '@/app/(dashboard)/banco-items/[instrumentId]/spec-table/SpecTableView';

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

  let instrument: InstrumentModel;
  try {
    instrument = await apiGet<InstrumentModel>(`/instruments/${instrumentId}`);
  } catch {
    notFound();
  }

  // Este backoffice es sólo para instrumentos oficiales.
  if (!instrument.isOfficial) redirect('/admin/instrumentos');

  const itemsResponse = await apiGet<ItemsListResponse>(
    `/items?instrumentId=${instrumentId}&limit=200`,
  );

  return (
    <SpecTableView
      instrument={instrument}
      items={itemsResponse.data ?? []}
      canEdit={false}
      basePath="/admin/instrumentos"
      breadcrumb={{ href: '/admin/instrumentos', label: 'Instrumentos oficiales' }}
    />
  );
}
