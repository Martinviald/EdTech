import { Suspense, cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { Printer } from 'lucide-react';
import {
  canAccess,
  SHEET_MANAGEMENT_ROLES,
  type AssessmentFormListResponse,
  type PaginatedResponse,
  type PrintRunModel,
  type SheetLayoutModel,
} from '@soe/types';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ApiRequestError } from '@/lib/errors';
import { ROUTES } from '@/lib/routes';
import { listClassGroupsForUser } from '@/lib/teacherAssignmentsApi';
import {
  BackLink,
  CardSkeleton,
  EmptyState,
  PageContainer,
  PageHeader,
  TableSkeleton,
} from '@/components/shared';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DownloadPdfButton } from '../../components/DownloadPdfButton';
import { AssignAssessmentControl } from '../../components/AssignAssessmentControl';
import { PrintRunDateControl } from '../../components/PrintRunDateControl';
import { HOJAS_ROUTES } from '../../lib/routes';
import { listInstrumentsForSheets } from '../../lib/instruments';
import { listAssessmentOptions } from '../../lib/assessment-options';
import { formatSheetDate } from '../../lib/format';
import { PrintRunForm, type CourseOption } from './PrintRunForm';

type PageProps = { params: Promise<{ id: string }> };

export default async function ImprimirPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, SHEET_MANAGEMENT_ROLES)) redirect(ROUTES.dashboard);
  const orgId = session.user.orgId;
  if (!orgId) redirect(ROUTES.dashboard);

  const { id: layoutId } = await params;

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={<BackLink href={HOJAS_ROUTES.index} label="Hojas de respuesta" />}
        title="Imprimir tirada"
        description="Elige el curso y las hojas de reserva: se genera un PDF con una hoja por alumno, cada una con su QR. Imprime al 100 % (sin ajustar a página)."
      />

      <Suspense fallback={<CardSkeleton />}>
        <SetupSection layoutId={layoutId} orgId={orgId} />
      </Suspense>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">Tiradas de este layout</h2>
        <Suspense fallback={<TableSkeleton />}>
          <HistorySection layoutId={layoutId} />
        </Suspense>
      </section>
    </PageContainer>
  );
}

async function SetupSection({ layoutId, orgId }: { layoutId: string; orgId: string }) {
  const layout = await getLayoutOrNotFound(layoutId);
  const [classGroups, instruments, assessments, forms] = await Promise.all([
    listClassGroupsForUser(orgId),
    listInstrumentsForSheets(),
    listAssessmentOptions(layout.instrumentId),
    apiGet<AssessmentFormListResponse>(`/sheet-print-runs/forms?layoutId=${layoutId}`),
  ]);

  const instrumentName =
    instruments.data.find((i) => i.id === layout.instrumentId)?.name ?? 'Instrumento sin nombre';

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-4 rounded-lg border bg-card p-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-muted-foreground">Instrumento</dt>
          <dd className="font-medium">{instrumentName}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Versión del layout</dt>
          <dd className="font-medium">v{layout.version}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Hash (viaja en el QR)</dt>
          <dd>
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{layout.specHash}</code>
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Páginas × campos</dt>
          <dd className="font-medium">
            {layout.pageCount} × {layout.fieldCount}
          </dd>
        </div>
      </dl>

      <PrintRunForm
        layoutId={layout.id}
        courses={buildCourseOptions(classGroups)}
        assessments={assessments}
        assessmentForms={forms.data.map((form) => ({ id: form.id, name: form.name }))}
      />
    </div>
  );
}

const getLayoutOrNotFound = cache(async (layoutId: string): Promise<SheetLayoutModel> => {
  try {
    return await apiGet<SheetLayoutModel>(`/sheet-layouts/${layoutId}`);
  } catch (e) {
    if (e instanceof ApiRequestError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
});

function buildCourseOptions(
  classGroups: Awaited<ReturnType<typeof listClassGroupsForUser>>,
): CourseOption[] {
  const byId = new Map<string, { option: CourseOption; gradeOrder: number }>();
  for (const cg of classGroups) {
    if (!byId.has(cg.classGroupId)) {
      byId.set(cg.classGroupId, {
        option: { id: cg.classGroupId, label: `${cg.className} · ${cg.academicYear}` },
        gradeOrder: cg.gradeOrder,
      });
    }
  }
  return Array.from(byId.values())
    .sort(
      (a, b) => a.gradeOrder - b.gradeOrder || a.option.label.localeCompare(b.option.label, 'es'),
    )
    .map((entry) => entry.option);
}

async function HistorySection({ layoutId }: { layoutId: string }) {
  const layout = await getLayoutOrNotFound(layoutId);
  const [runs, assessments] = await Promise.all([
    apiGet<PaginatedResponse<PrintRunModel>>(
      `/sheet-print-runs?layoutId=${layoutId}&page=1&limit=50`,
    ),
    listAssessmentOptions(layout.instrumentId),
  ]);

  if (runs.data.length === 0) {
    return (
      <EmptyState
        icon={Printer}
        title="Este layout aún no tiene tiradas"
        description="Genera la primera tirada eligiendo un curso arriba."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Creada</TableHead>
            <TableHead>Curso</TableHead>
            <TableHead>Fecha de aplicación</TableHead>
            <TableHead className="hidden sm:table-cell">Hojas</TableHead>
            <TableHead className="hidden sm:table-cell">Reservas</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.data.map((run) => (
            <TableRow key={run.id}>
              <TableCell className="text-muted-foreground">
                {formatSheetDate(run.createdAt)}
              </TableCell>
              <TableCell className="font-medium">{run.classGroupName ?? '—'}</TableCell>
              <TableCell>
                <PrintRunDateControl
                  runId={run.id}
                  administeredAt={run.administeredAt}
                  disabled={run.assessmentId === null}
                />
              </TableCell>
              <TableCell className="hidden sm:table-cell">{run.sheetCount}</TableCell>
              <TableCell className="hidden sm:table-cell">{run.spareCount}</TableCell>
              <TableCell>
                <div className="flex items-center justify-end gap-2">
                  {run.assessmentId ? null : (
                    <AssignAssessmentControl runId={run.id} assessments={assessments} />
                  )}
                  <DownloadPdfButton runId={run.id} />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
