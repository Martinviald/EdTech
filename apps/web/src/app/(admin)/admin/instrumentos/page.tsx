import { Suspense } from 'react';
import Link from 'next/link';
import { Library } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import type { InstrumentModel } from '@soe/types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, TableSkeleton } from '@/components/shared';

export const dynamic = 'force-dynamic';

type InstrumentListResponse = {
  data: InstrumentModel[];
  total: number;
  page: number;
  limit: number;
};

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
  draft: 'bg-warning/15 text-warning',
  published: 'bg-success/10 text-success',
  archived: 'bg-muted text-muted-foreground',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  published: 'Publicado',
  archived: 'Archivado',
};

/**
 * Backoffice de plataforma — inventario de instrumentos OFICIALES (org_id null,
 * compartidos por todas las orgs). Sólo `platform_admin` los gestiona; el
 * `(admin)/layout.tsx` ya exige `isPlatformAdmin`. Cada fila enlaza al detalle
 * donde se configura el enunciado, secciones e ítems.
 */
export default async function AdminInstrumentosPage() {
  return (
    <div className="space-y-6">
      <Suspense fallback={<InstrumentosListFallback />}>
        <InstrumentosListSection />
      </Suspense>
    </div>
  );
}

function InstrumentosListFallback() {
  return (
    <>
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <TableSkeleton />
    </>
  );
}

async function InstrumentosListSection() {
  const { data: instruments, total } = await apiGet<InstrumentListResponse>(
    '/instruments?isOfficial=true&pageSize=100',
  );

  const sorted = [...instruments].sort((a, b) => a.name.localeCompare(b.name, 'es'));

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Instrumentos oficiales</h1>
        <p className="text-sm text-muted-foreground">
          {total} instrumento{total === 1 ? '' : 's'} oficial{total === 1 ? '' : 'es'} de la
          plataforma. Son de solo lectura para los colegios; aquí puedes configurarlos.
        </p>
      </div>

      {sorted.length === 0 ? (
        <EmptyState
          title="Aún no hay instrumentos oficiales"
          description="Los instrumentos oficiales (DIA, SIMCE, etc.) se cargan desde el seed de la plataforma."
          icon={Library}
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead className="w-[120px]">Tipo</TableHead>
                <TableHead className="w-[90px]">Año</TableHead>
                <TableHead className="w-[120px]">Estado</TableHead>
                <TableHead className="w-[110px]">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((instrument) => (
                <TableRow key={instrument.id}>
                  <TableCell className="font-medium">{instrument.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {TYPE_LABELS[instrument.type] ?? instrument.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {instrument.year ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`border-0 text-xs ${STATUS_COLORS[instrument.status] ?? ''}`}
                    >
                      {STATUS_LABELS[instrument.status] ?? instrument.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={ROUTES.adminInstrumento(instrument.id)}
                      className="text-sm text-primary underline-offset-4 hover:underline"
                    >
                      Gestionar
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
