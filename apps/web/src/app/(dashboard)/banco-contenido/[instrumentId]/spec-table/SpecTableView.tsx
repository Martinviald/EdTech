import Link from 'next/link';
import type { Route } from 'next';
import { Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, PageActions } from '@/components/shared';
import { SetPageTitle } from '@/components/layout/page-title-context';
import type { InstrumentModel, ItemModel } from '@soe/types';
import { SpecTableReview } from './SpecTableReview';

/**
 * Vista de la tabla de especificaciones de un instrumento (revisión de ítems ↔
 * nodos de taxonomía). Compartida por dos rutas, igual que
 * `InstrumentDetailView`:
 *   · `/banco-contenido/[id]/spec-table`          (dashboard del colegio)
 *   · `/admin/instrumentos/[id]/spec-table`   (backoffice de plataforma)
 *
 * `canEdit` habilita la edición inline y el botón "Cargar tabla de
 * especificaciones" (que vive bajo `${basePath}/${id}/spec-table/cargar`). En el
 * backoffice se pasa `canEdit={false}`: la tabla es de solo lectura y el flujo de
 * carga vive en el dashboard del colegio.
 * `basePath` prefija el enlace al detalle del instrumento y al flujo de carga;
 */
export function SpecTableView({
  instrument,
  items,
  canEdit,
  basePath,
}: {
  instrument: InstrumentModel;
  items: ItemModel[];
  canEdit: boolean;
  basePath: string;
}) {
  const hasItems = items.length > 0;
  const taggedCount = items.filter((it) => (it.tags?.length ?? 0) > 0).length;
  const cargarHref = `${basePath}/${instrument.id}/spec-table/cargar` as Route;

  return (
    <div className="space-y-6">
      {/* El título va en la barra superior; el camino de vuelta es el propio
          instrumento (el hub queda a un salto más, en el sidebar). */}
      <SetPageTitle
        title="Tabla de especificaciones"
        parentHref={`${basePath}/${instrument.id}`}
        parentLabel={instrument.name}
      />
      {hasItems && canEdit && (
        <PageActions>
          <Link href={cargarHref}>
            <Button variant="outline">Cargar tabla de especificaciones</Button>
          </Link>
        </PageActions>
      )}

      {hasItems ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {items.length} ítem{items.length === 1 ? '' : 's'} · {taggedCount} con nodos vinculados
          </p>
          <SpecTableReview
            items={items}
            sections={instrument.sections ?? []}
            canEdit={canEdit}
            instrumentId={instrument.id}
          />
        </div>
      ) : (
        <EmptyState
          icon={Table2}
          title="Aún no hay tabla de especificaciones"
          description={
            canEdit
              ? 'Este instrumento todavía no tiene ítems con nodos de taxonomía vinculados. Carga un archivo Excel o CSV para vincular los ítems automáticamente.'
              : 'Este instrumento todavía no tiene ítems con nodos de taxonomía vinculados.'
          }
          action={
            canEdit ? (
              <Link href={cargarHref}>
                <Button>Cargar tabla de especificaciones</Button>
              </Link>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
