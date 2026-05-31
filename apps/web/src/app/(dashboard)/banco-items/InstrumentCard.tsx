import Link from 'next/link';
import type { Route } from 'next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge, type StatusTone } from '@/components/patterns';
import type { InstrumentModel } from '@soe/types';

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

export function InstrumentCard({ instrument }: { instrument: InstrumentModel }) {
  return (
    <Link
      href={`/banco-items/${instrument.id}` as Route}
      className="group block rounded-xl border bg-card transition-shadow hover:shadow-md hover:shadow-primary/5"
    >
      <Card className="border-0 shadow-none">
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base leading-tight group-hover:text-primary">
              {instrument.name}
            </CardTitle>
            <StatusBadge tone={STATUS_TONES[instrument.status] ?? 'warning'}>
              {STATUS_LABELS[instrument.status] ?? instrument.status}
            </StatusBadge>
          </div>
        </CardHeader>
        <CardContent className="space-y-1 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
              {TYPE_LABELS[instrument.type] ?? instrument.type}
            </span>
            {instrument.year && <span>Ano {instrument.year}</span>}
          </div>
          {instrument.version && <div>Version: {instrument.version}</div>}
        </CardContent>
      </Card>
    </Link>
  );
}
