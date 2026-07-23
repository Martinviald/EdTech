import Link from 'next/link';
import type { Route } from 'next';
import { Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared';
import type { InstrumentModel, ItemModel } from '@soe/types';
import { SpecTableReview } from './SpecTableReview';

/**
 * Vista de la tabla de especificaciones de un instrumento (breadcrumb + encabezado
 * + revisión de ítems ↔ nodos de taxonomía). Compartida por dos rutas, igual que
 * `InstrumentDetailView`:
 *   · `/banco-items/[id]/spec-table`          (dashboard del colegio)
 *   · `/admin/instrumentos/[id]/spec-table`   (backoffice de plataforma)
 *
 * `canEdit` habilita la edición inline y el botón "Cargar tabla de
 * especificaciones" (que vive bajo `${basePath}/${id}/spec-table/cargar`). En el
 * backoffice se pasa `canEdit={false}`: la tabla es de solo lectura y el flujo de
 * carga vive en el dashboard del colegio.
 * `basePath` prefija el enlace al detalle del instrumento y al flujo de carga;
 * `breadcrumb` es la raíz (banco de ítems / instrumentos oficiales).
 */
export function SpecTableView({
  instrument,
  items,
  canEdit,
  basePath,
  breadcrumb,
}: {
  instrument: InstrumentModel;
  items: ItemModel[];
  canEdit: boolean;
  basePath: string;
  breadcrumb: { href: string; label: string };
}) {
  const hasItems = items.length > 0;
  const taggedCount = items.filter((it) => (it.tags?.length ?? 0) > 0).length;
  const cargarHref = `${basePath}/${instrument.id}/spec-table/cargar` as Route;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href={breadcrumb.href as Route} className="hover:text-foreground">
              {breadcrumb.label}
            </Link>
            <span>/</span>
            <Link href={`${basePath}/${instrument.id}` as Route} className="hover:text-foreground">
              {instrument.name}
            </Link>
            <span>/</span>
            <span>Tabla de especificaciones</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold">Tabla de especificaciones</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Revisa los ítems del instrumento con los nodos de taxonomía (OA, habilidad, contenido,
            tipo de texto) vinculados a cada uno.
          </p>
        </div>

        {hasItems && canEdit && (
          <Link href={cargarHref}>
            <Button variant="outline">Cargar tabla de especificaciones</Button>
          </Link>
        )}
      </div>

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
