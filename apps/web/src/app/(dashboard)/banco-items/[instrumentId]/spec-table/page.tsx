import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { Table2 } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/patterns';
import {
  canAccess,
  ITEM_BANK_ROLES,
  type InstrumentModel,
} from '@soe/types';
import { SpecTableReview, type SpecTableResponse } from './SpecTableReview';

interface PageProps {
  params: Promise<{ instrumentId: string }>;
}

export default async function SpecTablePage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, ITEM_BANK_ROLES)) redirect('/dashboard');

  const { instrumentId } = await params;

  const [instrument, specTable] = await Promise.all([
    apiGet<InstrumentModel>(`/instruments/${instrumentId}`),
    apiGet<SpecTableResponse>(`/spec-tables/${instrumentId}`),
  ]);

  const items = specTable.items ?? [];
  const hasItems = items.length > 0;
  const taggedCount = items.filter((it) => it.tags.length > 0).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href={'/banco-items' as Route} className="hover:text-foreground">
              Banco de Instrumentos
            </Link>
            <span>/</span>
            <Link
              href={`/banco-items/${instrumentId}` as Route}
              className="hover:text-foreground"
            >
              {instrument.name}
            </Link>
            <span>/</span>
            <span>Tabla de especificaciones</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold">Tabla de especificaciones</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Revisa los ítems del instrumento con los nodos de taxonomía (OA, habilidad,
            contenido, tipo de texto) vinculados a cada uno.
          </p>
        </div>

        {hasItems && (
          <Link href={`/banco-items/${instrumentId}/spec-table/cargar` as Route}>
            <Button variant="outline">Cargar tabla de especificaciones</Button>
          </Link>
        )}
      </div>

      {hasItems ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {items.length} ítem{items.length === 1 ? '' : 's'} · {taggedCount} con nodos
            vinculados
          </p>
          <SpecTableReview items={items} />
        </div>
      ) : (
        <EmptyState
          icon={Table2}
          title="Aún no hay tabla de especificaciones"
          description="Este instrumento todavía no tiene ítems con nodos de taxonomía vinculados. Carga un archivo Excel o CSV para vincular los ítems automáticamente."
          action={
            <Link href={`/banco-items/${instrumentId}/spec-table/cargar` as Route}>
              <Button>Cargar tabla de especificaciones</Button>
            </Link>
          }
        />
      )}
    </div>
  );
}
