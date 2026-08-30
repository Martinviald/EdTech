import { cache, Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ScanLine } from 'lucide-react';
import {
  canAccess,
  SHEET_MANAGEMENT_ROLES,
  type BatchStatusModel,
  type PaginatedResponse,
  type PrintRunAssessmentOption,
  type PrintRunModel,
} from '@soe/types';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import {
  BackLink,
  CardSkeleton,
  EmptyState,
  PageContainer,
  PageHeader,
  StatusBadge,
  TableSkeleton,
} from '@/components/shared';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { HOJAS_ROUTES } from '../lib/routes';
import { listInstrumentsForSheets } from '../lib/instruments';
import { listAssessmentOptionsByInstrument } from '../lib/assessment-options';
import { assessmentLabel } from '../lib/assessments';
import { formatSheetDate } from '../lib/format';
import { ScanUploadForm, type PrintRunOption } from './ScanUploadForm';
import { BATCH_STATUS_META, SCAN_ROUTES } from './batch-meta';

export default async function EscanearPage() {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, SHEET_MANAGEMENT_ROLES)) redirect(ROUTES.dashboard);

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={<BackLink href={HOJAS_ROUTES.index} label="Hojas de respuesta" />}
        title="Escanear pruebas"
        description="Sube las hojas rendidas de una tirada (PDF del escáner o fotos del celular). El lector procesa las marcas y te muestra lo dudoso para revisarlo antes de confirmar."
      />

      <Suspense fallback={<CardSkeleton />}>
        <UploadSection />
      </Suspense>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">Lotes recientes</h2>
        <Suspense fallback={<TableSkeleton />}>
          <RecentBatchesSection />
        </Suspense>
      </section>
    </PageContainer>
  );
}

const fetchPrintRunOptions = cache(
  async (): Promise<{
    options: PrintRunOption[];
    assessmentsByInstrument: Record<string, PrintRunAssessmentOption[]>;
    labelsById: Map<string, string>;
  }> => {
    const [runs, instruments] = await Promise.all([
      apiGet<PaginatedResponse<PrintRunModel>>('/sheet-print-runs?page=1&limit=100'),
      listInstrumentsForSheets(),
    ]);
    const instrumentNames = new Map(instruments.data.map((i) => [i.id, i.name]));
    const assessmentsByInstrument = await listAssessmentOptionsByInstrument(
      runs.data.map((run) => run.instrumentId),
    );

    const options = runs.data.map((run) => {
      const assessment = run.assessmentId
        ? assessmentsByInstrument[run.instrumentId]?.find((a) => a.id === run.assessmentId)
        : undefined;
      return {
        id: run.id,
        instrumentId: run.instrumentId,
        courseLabel: run.classGroupName ?? 'Sin curso',
        instrumentName: instrumentNames.get(run.instrumentId) ?? 'Instrumento sin nombre',
        sheetCount: run.sheetCount,
        createdLabel: formatSheetDate(run.createdAt),
        assessmentName: assessment
          ? assessmentLabel(assessment)
          : run.assessmentId
            ? 'Evaluación asociada'
            : null,
        imprimirHref: HOJAS_ROUTES.imprimir(run.layoutId),
      } satisfies PrintRunOption;
    });

    const labelsById = new Map(
      options.map((o) => [
        o.id,
        `${o.courseLabel} — ${o.instrumentName} — ${o.sheetCount} hojas · ${o.createdLabel}`,
      ]),
    );
    return { options, assessmentsByInstrument, labelsById };
  },
);

async function UploadSection() {
  const { options, assessmentsByInstrument } = await fetchPrintRunOptions();

  if (options.length === 0) {
    return (
      <EmptyState
        icon={ScanLine}
        title="Aún no hay tiradas para escanear"
        description="Primero diseña una hoja e imprime una tirada por curso: recién entonces habrá hojas físicas que escanear."
      />
    );
  }

  return <ScanUploadForm printRuns={options} assessmentsByInstrument={assessmentsByInstrument} />;
}

async function RecentBatchesSection() {
  const [batches, { labelsById }] = await Promise.all([
    apiGet<PaginatedResponse<BatchStatusModel>>('/sheet-scan-batches?page=1&limit=20'),
    fetchPrintRunOptions(),
  ]);

  if (batches.data.length === 0) {
    return (
      <EmptyState
        icon={ScanLine}
        title="Aún no hay lotes de escaneo"
        description="Cuando subas el primer lote, acá verás su estado y el acceso a la cola de revisión."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Tirada</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="hidden sm:table-cell">Páginas leídas</TableHead>
            <TableHead className="hidden sm:table-cell">Pendientes</TableHead>
            <TableHead className="hidden md:table-cell">Fecha</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.data.map((batch) => {
            const meta = BATCH_STATUS_META[batch.status];
            return (
              <TableRow key={batch.id}>
                <TableCell className="max-w-xs truncate font-medium">
                  {labelsById.get(batch.printRunId) ?? 'Tirada eliminada'}
                </TableCell>
                <TableCell>
                  <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {batch.pagesRead}
                  {batch.pagesTotal !== null ? ` / ${batch.pagesTotal}` : ''}
                </TableCell>
                <TableCell className="hidden sm:table-cell">{batch.reviewPending}</TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {formatSheetDate(batch.createdAt)}
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="outline" size="sm">
                    <Link href={SCAN_ROUTES.revisar(batch.id)}>
                      {batch.status === 'needs_review' ? 'Revisar' : 'Ver'}
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
