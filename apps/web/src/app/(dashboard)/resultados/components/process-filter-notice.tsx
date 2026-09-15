import Link from 'next/link';
import { CalendarRange } from 'lucide-react';
import type { MeasurementProcessModel } from '@soe/types';
import { apiGet } from '@/lib/api';
import { AlertCallout } from '@/components/shared';
import { ROUTES } from '@/lib/routes';

export async function ProcessFilterNotice({
  processId,
  clearHref,
}: {
  processId: string;
  clearHref: string;
}) {
  let process: MeasurementProcessModel | null = null;
  try {
    process = await apiGet<MeasurementProcessModel>(`/measurement-processes/${processId}`);
  } catch {
    return null;
  }

  return (
    <AlertCallout tone="info" icon={CalendarRange} title={`Acotado a: ${process.name}`}>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>Solo se muestran las evaluaciones de este proceso de medición.</span>
        <Link href={ROUTES.proceso(process.id)} className="text-primary hover:underline">
          Ver el proceso
        </Link>
        <Link href={clearHref} className="text-primary hover:underline">
          Quitar el filtro
        </Link>
      </span>
    </AlertCallout>
  );
}
