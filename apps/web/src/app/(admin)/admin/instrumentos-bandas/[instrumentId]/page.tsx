import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { InstrumentModel, PerformanceBandListResponse } from '@soe/types';
import { apiGet } from '@/lib/api';
import { BandsForm } from '@/components/instrument-bands/bands-form';
import { ROUTES } from '@/lib/routes';

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
    apiGet<PerformanceBandListResponse>(
      `/performance-bands?instrumentId=${instrumentId}`,
    ),
  ]);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href={ROUTES.adminInstrumentosBandas}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Link>
        <h1 className="text-2xl font-semibold">{instrument.name}</h1>
        <p className="text-muted-foreground text-sm">
          Niveles de logro del instrumento (globales, compartidos por todas las organizaciones).
        </p>
      </div>

      <BandsForm instrumentId={instrumentId} initial={bands.data} />
    </div>
  );
}
