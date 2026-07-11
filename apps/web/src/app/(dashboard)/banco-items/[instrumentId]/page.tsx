import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  canAccess,
  userHasAnyRole,
  ITEM_VIEWER_ROLES,
  ITEM_BANK_ROLES,
  type InstrumentModel,
  type ItemModel,
} from '@soe/types';
import { ItemsTable } from './ItemsTable';
import { SectionsList } from './SectionsList';
import { EnunciadoPdfCard } from './EnunciadoPdfCard';

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

type ItemsListResponse = {
  data: ItemModel[];
  total: number;
  page: number;
  limit: number;
};

type PageProps = {
  params: Promise<{ instrumentId: string }>;
};

export default async function InstrumentDetailPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, ITEM_VIEWER_ROLES)) redirect('/dashboard');

  const { instrumentId } = await params;

  const [instrument, itemsResponse] = await Promise.all([
    apiGet<InstrumentModel>(`/instruments/${instrumentId}`),
    apiGet<ItemsListResponse>(`/items?instrumentId=${instrumentId}&limit=200`),
  ]);

  const canEdit = userHasAnyRole(session.user.roles, ITEM_BANK_ROLES);
  const items = itemsResponse.data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Link
              href={'/banco-items' as Route}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Banco de Instrumentos
            </Link>
            <span className="text-sm text-muted-foreground">/</span>
          </div>
          <h1 className="text-2xl font-semibold">{instrument.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {TYPE_LABELS[instrument.type] ?? instrument.type}
            </Badge>
            <Badge
              variant="outline"
              className={`border-0 text-xs ${STATUS_COLORS[instrument.status] ?? ''}`}
            >
              {STATUS_LABELS[instrument.status] ?? instrument.status}
            </Badge>
            {instrument.year && (
              <span className="text-xs text-muted-foreground">Ano {instrument.year}</span>
            )}
            {instrument.version && (
              <span className="text-xs text-muted-foreground">v{instrument.version}</span>
            )}
          </div>
        </div>

        {canEdit && (
          <div className="flex gap-2">
            <Link href={`/banco-items/${instrumentId}/spec-table` as Route}>
              <Button variant="outline" size="sm">
                Tabla de especificaciones
              </Button>
            </Link>
            <Link href={`/banco-items/${instrumentId}/etiquetar` as Route}>
              <Button variant="outline" size="sm">
                Etiquetar con IA
              </Button>
            </Link>
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Items</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm font-medium">{items.length}</p>
          </CardContent>
        </Card>
        {instrument.isOfficial && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">Origen</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm font-medium">Oficial</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* PDF del enunciado (TKT-15) */}
      <EnunciadoPdfCard
        instrumentId={instrumentId}
        enunciadoPdf={instrument.enunciadoPdf ?? null}
        canEdit={canEdit}
      />

      {/* Sections */}
      {instrument.sections && instrument.sections.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase text-muted-foreground">Secciones</h2>
          <SectionsList sections={instrument.sections} />
        </section>
      )}

      {/* Items table */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase text-muted-foreground">
          Items ({items.length})
        </h2>
        <ItemsTable
          items={items}
          sections={instrument.sections ?? []}
          canEdit={canEdit}
          instrumentId={instrumentId}
        />
      </section>
    </div>
  );
}
