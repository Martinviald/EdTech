import type { InstrumentModel, PerformanceBandListResponse } from '@soe/types';
import { apiGet } from '@/lib/api';
import { BandsForm } from '@/components/instrument-bands/bands-form';
import { SetPageTitle } from '@/components/layout/page-title-context';

export const dynamic = 'force-dynamic';

/**
 * Editor de niveles/umbrales de un instrumento. Carga el instrumento (nombre) y
 * su set actual de bandas globales, y delega la edición al form cliente.
 */
export default async function InstrumentBandsEditorPage({
  params,
}: {
  params: Promise<{ instrumentId: string }>;
}) {
  const { instrumentId } = await params;

  const [instrument, bands] = await Promise.all([
    apiGet<InstrumentModel>(`/instruments/${instrumentId}`),
    apiGet<PerformanceBandListResponse>(`/performance-bands?instrumentId=${instrumentId}`),
  ]);

  return (
    <div className="space-y-6">
      <SetPageTitle title={instrument.name} />
      <p className="text-muted-foreground text-sm">
        Niveles de logro del instrumento (globales, compartidos por todas las organizaciones).
      </p>

      <BandsForm instrumentId={instrumentId} initial={bands.data} />
    </div>
  );
}
