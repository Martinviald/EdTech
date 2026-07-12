import Link from 'next/link';
import type { Route } from 'next';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { InstrumentModel, ItemModel } from '@soe/types';
import { ItemsTable } from './ItemsTable';
import { SectionsList } from './SectionsList';
import { EnunciadoPdfCard } from './EnunciadoPdfCard';
import { EnunciadoViewButton } from '@/components/instruments/EnunciadoViewButton';

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

/**
 * Vista de detalle de un instrumento (encabezado + metadata + PDF de enunciado +
 * secciones + ítems). Es compartida por dos rutas:
 *  · `/banco-items/[id]`            (dashboard del colegio)
 *  · `/admin/instrumentos/[id]`     (backoffice de plataforma)
 *
 * `canEdit` decide si se muestran las acciones de modificación (subir/eliminar PDF,
 * editar ítems). Los instrumentos OFICIALES son de solo lectura para todos menos
 * `platform_admin` — quien resuelve `canEdit` es la página, no este componente. El
 * backend (`InstrumentsService.assertEditable`) es la barrera real.
 *
 * `basePath` prefija los enlaces de autoría (tabla de especificaciones, etiquetado
 * IA); `showAuthoringLinks` los oculta donde no aplican (backoffice: los flujos de
 * autoría avanzada viven en el dashboard del colegio).
 */
export function InstrumentDetailView({
  instrument,
  items,
  canEdit,
  basePath,
  breadcrumb,
  showAuthoringLinks = true,
}: {
  instrument: InstrumentModel;
  items: ItemModel[];
  canEdit: boolean;
  basePath: string;
  breadcrumb: { href: string; label: string };
  showAuthoringLinks?: boolean;
}) {
  const readOnlyOfficial = instrument.isOfficial && !canEdit;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Link
              href={breadcrumb.href as Route}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              {breadcrumb.label}
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
            {instrument.isOfficial && (
              <Badge
                variant="outline"
                className="border-0 bg-blue-100 text-xs text-blue-800 dark:bg-blue-950 dark:text-blue-200"
              >
                Oficial
              </Badge>
            )}
            {instrument.year && (
              <span className="text-xs text-muted-foreground">Ano {instrument.year}</span>
            )}
            {instrument.version && (
              <span className="text-xs text-muted-foreground">v{instrument.version}</span>
            )}
          </div>
        </div>

        {(instrument.enunciadoPdf || (canEdit && showAuthoringLinks)) && (
          <div className="flex flex-wrap gap-2">
            {instrument.enunciadoPdf && (
              <EnunciadoViewButton enunciadoPdf={instrument.enunciadoPdf} />
            )}
            {canEdit && showAuthoringLinks && (
              <>
                <Link href={`${basePath}/${instrument.id}/spec-table` as Route}>
                  <Button variant="outline" size="sm">
                    Tabla de especificaciones
                  </Button>
                </Link>
                <Link href={`${basePath}/${instrument.id}/etiquetar` as Route}>
                  <Button variant="outline" size="sm">
                    Etiquetar con IA
                  </Button>
                </Link>
              </>
            )}
          </div>
        )}
      </div>

      {/* Aviso de solo lectura para instrumentos oficiales (no platform_admin) */}
      {readOnlyOfficial && (
        <p className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          <Lock className="size-3.5 shrink-0" aria-hidden />
          Este instrumento es oficial de la plataforma y es de solo lectura. Su configuración
          (enunciado, secciones e ítems) la mantiene el equipo de la plataforma.
        </p>
      )}

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

      {/* PDF del enunciado (TKT-15) — panel de gestión (subir / reemplazar / eliminar)
          sólo para editores. La previsualización y descarga viven en el botón
          "Ver enunciado" del encabezado, disponible para todos. */}
      {canEdit && (
        <EnunciadoPdfCard
          instrumentId={instrument.id}
          enunciadoPdf={instrument.enunciadoPdf ?? null}
          canEdit={canEdit}
        />
      )}

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
          instrumentId={instrument.id}
        />
      </section>
    </div>
  );
}
