import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import {
  canAccess,
  SHEET_REVIEW_ROLES,
  type BatchStatusModel,
  type PrintRunModel,
} from '@soe/types';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import { getClassGroupDetail } from '@/lib/teacherAssignmentsApi';
import { BackLink, CardSkeleton, PageContainer, PageHeader } from '@/components/shared';
import { SCAN_ROUTES } from '../../../escanear/batch-meta';
import { HOJAS_ROUTES } from '../../../lib/routes';
import { listAssessmentOptions } from '../../../lib/assessment-options';
import { ReviewShell, type AssessmentGap, type StudentOption } from './ReviewShell';

type PageProps = { params: Promise<{ batchId: string }> };

export default async function RevisarPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, SHEET_REVIEW_ROLES)) redirect(ROUTES.dashboard);
  const orgId = session.user.orgId;
  if (!orgId) redirect(ROUTES.dashboard);

  const { batchId } = await params;

  return (
    <PageContainer>
      <PageHeader
        breadcrumb={<BackLink href={SCAN_ROUTES.escanear} label="Escanear pruebas" />}
        title="Revisión del lote"
        description="Sigue el procesamiento y resuelve lo que el lector no pudo decidir solo: páginas rechazadas, hojas sin identidad y marcas dudosas. Nada se persiste hasta que confirmes."
      />

      <Suspense fallback={<CardSkeleton />}>
        <BatchSection batchId={batchId} orgId={orgId} />
      </Suspense>
    </PageContainer>
  );
}

async function BatchSection({ batchId, orgId }: { batchId: string; orgId: string }) {
  let batch: BatchStatusModel;
  try {
    batch = await apiGet<BatchStatusModel>(`/sheet-scan-batches/${batchId}`);
  } catch {
    notFound();
  }

  let students: StudentOption[] = [];
  let rosterAvailable = false;
  let assessmentGap: AssessmentGap | null = null;
  let assessmentId: string | null = null;
  try {
    const run = await apiGet<PrintRunModel>(`/sheet-print-runs/${batch.printRunId}`);
    assessmentId = run.assessmentId ?? null;
    if (!run.assessmentId) {
      assessmentGap = {
        runId: run.id,
        imprimirHref: HOJAS_ROUTES.imprimir(run.layoutId),
        assessments: await listAssessmentOptions(run.instrumentId).catch(() => []),
      };
    }
    if (run.classGroupId) {
      const detail = await getClassGroupDetail(orgId, run.classGroupId);
      students = detail.students
        .filter((student) => student.enrollmentStatus === 'active')
        .map((student) => ({
          studentId: student.studentId,
          name: `${student.lastName}, ${student.firstName}`,
        }));
      rosterAvailable = true;
    }
  } catch {
    rosterAvailable = false;
  }

  return (
    <ReviewShell
      batchId={batchId}
      initialBatch={batch}
      students={students}
      rosterAvailable={rosterAvailable}
      assessmentGap={assessmentGap}
      assessmentId={assessmentId}
    />
  );
}
