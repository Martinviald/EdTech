import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { FileText, Printer } from 'lucide-react';
import {
  canAccess,
  SHEET_MANAGEMENT_ROLES,
  type PaginatedResponse,
  type PrintRunModel,
  type SheetLayoutSummaryModel,
} from '@soe/types';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import { PageContainer, PageHeader, EmptyState, TableSkeleton } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DesignSheetDialog } from './components/DesignSheetDialog';
import { DownloadPdfButton } from './components/DownloadPdfButton';
import { HOJAS_ROUTES } from './lib/routes';
import { listInstrumentsForSheets } from './lib/instruments';
import { formatSheetDate } from './lib/format';

export default async function HojasPage() {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, SHEET_MANAGEMENT_ROLES)) redirect(ROUTES.dashboard);

  return (
    <PageContainer>
      <PageHeader
        title="Hojas de respuesta"
        description="Diseña la hoja desde un instrumento, imprímela por curso, escanea las pruebas rendidas y revisa las lecturas antes de confirmar los resultados."
        actions={
          <Suspense fallback={<Skeleton className="h-10 w-36" />}>
            <DesignSheetAction />
          </Suspense>
        }
      />

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">Layouts congelados</h2>
        <Suspense fallback={<TableSkeleton />}>
          <LayoutsSection />
        </Suspense>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">Tiradas de impresión</h2>
        <Suspense fallback={<TableSkeleton />}>
          <PrintRunsSection />
        </Suspense>
      </section>
    </PageContainer>
  );
}

async function DesignSheetAction() {
  const { data: instruments } = await listInstrumentsForSheets();

  return (
    <DesignSheetDialog
      instruments={instruments.map(({ id, name, year, type }) => ({ id, name, year, type }))}
    />
  );
}

async function LayoutsSection() {
  const [layouts, instruments] = await Promise.all([
    apiGet<PaginatedResponse<SheetLayoutSummaryModel>>('/sheet-layouts?page=1&limit=50'),
    listInstrumentsForSheets(),
  ]);

  if (layouts.data.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="Aún no hay layouts congelados"
        description="Diseña una hoja desde un instrumento: la propuesta se revisa y se congela antes de imprimir."
      />
    );
  }

  const instrumentNames = new Map(instruments.data.map((i) => [i.id, i.name]));

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Instrumento</TableHead>
            <TableHead>Versión</TableHead>
            <TableHead className="hidden md:table-cell">Hash</TableHead>
            <TableHead className="hidden sm:table-cell">Páginas</TableHead>
            <TableHead className="hidden sm:table-cell">Campos</TableHead>
            <TableHead className="hidden md:table-cell">Creado</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {layouts.data.map((layout) => (
            <TableRow key={layout.id}>
              <TableCell className="font-medium">
                {instrumentNames.get(layout.instrumentId) ?? 'Instrumento sin nombre'}
              </TableCell>
              <TableCell>v{layout.version}</TableCell>
              <TableCell className="hidden md:table-cell">
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{layout.specHash}</code>
              </TableCell>
              <TableCell className="hidden sm:table-cell">{layout.pageCount}</TableCell>
              <TableCell className="hidden sm:table-cell">{layout.fieldCount}</TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">
                {formatSheetDate(layout.createdAt)}
              </TableCell>
              <TableCell className="text-right">
                <Button asChild variant="outline" size="sm">
                  <Link href={HOJAS_ROUTES.imprimir(layout.id)}>
                    <Printer className="mr-2 size-4" />
                    Imprimir
                  </Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

async function PrintRunsSection() {
  const [runs, instruments] = await Promise.all([
    apiGet<PaginatedResponse<PrintRunModel>>('/sheet-print-runs?page=1&limit=50'),
    listInstrumentsForSheets(),
  ]);

  if (runs.data.length === 0) {
    return (
      <EmptyState
        icon={Printer}
        title="Aún no hay tiradas de impresión"
        description="Cuando congeles un layout podrás generar el PDF con una hoja por alumno del curso, más reservas."
      />
    );
  }

  const instrumentNames = new Map(instruments.data.map((i) => [i.id, i.name]));

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Instrumento</TableHead>
            <TableHead>Curso</TableHead>
            <TableHead className="hidden sm:table-cell">Hojas</TableHead>
            <TableHead className="hidden sm:table-cell">Reservas</TableHead>
            <TableHead className="hidden md:table-cell">Fecha</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.data.map((run) => (
            <TableRow key={run.id}>
              <TableCell className="font-medium">
                {instrumentNames.get(run.instrumentId) ?? 'Instrumento sin nombre'}
              </TableCell>
              <TableCell>{run.classGroupName ?? '—'}</TableCell>
              <TableCell className="hidden sm:table-cell">{run.sheetCount}</TableCell>
              <TableCell className="hidden sm:table-cell">{run.spareCount}</TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">
                {formatSheetDate(run.createdAt)}
              </TableCell>
              <TableCell className="text-right">
                <DownloadPdfButton runId={run.id} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
