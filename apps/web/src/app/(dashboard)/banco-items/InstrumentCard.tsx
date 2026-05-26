import Link from 'next/link';
import type { Route } from 'next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200',
  published: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
  archived: 'bg-gray-100 text-gray-800 dark:bg-gray-950 dark:text-gray-200',
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
      className="group block rounded-lg border bg-card transition-shadow hover:shadow-md"
    >
      <Card className="border-0 shadow-none">
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base leading-tight group-hover:text-primary">
              {instrument.name}
            </CardTitle>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[instrument.status] ?? STATUS_COLORS.draft}`}
            >
              {STATUS_LABELS[instrument.status] ?? instrument.status}
            </span>
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
