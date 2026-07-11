import { notFound, redirect } from 'next/navigation';
import { apiGet } from '@/lib/api';
import type { InstrumentModel, ItemModel } from '@soe/types';
import { InstrumentDetailView } from '@/app/(dashboard)/banco-items/[instrumentId]/InstrumentDetailView';

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
 * Backoffice de plataforma — detalle/gestión de un instrumento OFICIAL. El
 * `(admin)/layout.tsx` ya exige `isPlatformAdmin`, por lo que `canEdit` es
 * siempre `true` aquí (el backend lo re-verifica en cada mutación). Esta ruta
 * sólo gestiona instrumentos oficiales: un instrumento propio de un colegio se
 * redirige a la lista.
 */
export default async function AdminInstrumentoDetailPage({ params }: PageProps) {
  const { instrumentId } = await params;

  let instrument: InstrumentModel;
  try {
    instrument = await apiGet<InstrumentModel>(`/instruments/${instrumentId}`);
  } catch {
    notFound();
  }

  // Este backoffice es sólo para instrumentos oficiales. Un instrumento propio de
  // un colegio se gestiona desde el dashboard del colegio, no desde aquí.
  if (!instrument.isOfficial) redirect('/admin/instrumentos');

  const itemsResponse = await apiGet<ItemsListResponse>(
    `/items?instrumentId=${instrumentId}&limit=200`,
  );

  return (
    <InstrumentDetailView
      instrument={instrument}
      items={itemsResponse.data}
      canEdit
      basePath="/admin/instrumentos"
      breadcrumb={{ href: '/admin/instrumentos', label: 'Instrumentos oficiales' }}
      showAuthoringLinks={false}
    />
  );
}
