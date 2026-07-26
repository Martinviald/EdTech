import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { StatusBadge, type StatusTone } from '@/components/shared';
import { INSTRUMENT_APPLICATION_PERIOD_LABELS, type InstrumentModel } from '@soe/types';
import { ROUTES } from '@/lib/routes';

const TYPE_LABELS: Record<string, string> = {
  dia: 'DIA',
  simce: 'SIMCE',
  paes: 'PAES',
  cambridge_mock: 'Cambridge',
  aptus: 'Aptus',
  desafio: 'Desafio',
  pal: 'PAL',
  custom: 'Personalizado',
};

const STATUS_TONES: Record<string, StatusTone> = {
  draft: 'warning',
  published: 'success',
  archived: 'neutral',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  published: 'Publicado',
  archived: 'Archivado',
};

/**
 * Fila compacta de un instrumento en la vista de lista del banco (TKT-08).
 * Reemplaza la tarjeta ("caluga") por un formato más denso y escaneable.
 * Toda la fila es un enlace al detalle del instrumento.
 */
export function InstrumentRow({ instrument }: { instrument: InstrumentModel }) {
  return (
    <Link
      href={ROUTES.bancoItem(instrument.id)}
      className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium leading-tight group-hover:text-primary">
          {instrument.name}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
            {TYPE_LABELS[instrument.type] ?? instrument.type}
          </span>
          {instrument.year ? <span>Año {instrument.year}</span> : null}
          {instrument.applicationPeriod ? (
            <span>{INSTRUMENT_APPLICATION_PERIOD_LABELS[instrument.applicationPeriod]}</span>
          ) : null}
          {instrument.version ? <span>v{instrument.version}</span> : null}
        </div>
      </div>
      <StatusBadge tone={STATUS_TONES[instrument.status] ?? 'warning'}>
        {STATUS_LABELS[instrument.status] ?? instrument.status}
      </StatusBadge>
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
        aria-hidden
      />
    </Link>
  );
}
