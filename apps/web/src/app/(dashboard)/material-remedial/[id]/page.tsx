import { Suspense } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import {
  canAccess,
  validateRemedialContent,
  REMEDIAL_VIEWER_ROLES,
  REMEDIAL_APPROVER_ROLES,
  type RemedialContent,
  type RemedialMaterialModel,
  type RemedialStudentMaterialModel,
} from '@soe/types';
import { Skeleton } from '@/components/ui/skeleton';
import {
  PageContainer,
  PageHeader,
  EmptyState,
  AlertCallout,
  StatusBadge,
  CardSkeleton,
} from '@/components/shared';
import { RemedialPoller } from '../components/remedial-poller';
import { RemedialMaterialView } from '../components/remedial-material-view';
import {
  REMEDIAL_STATUS_LABELS,
  REMEDIAL_STATUS_TONE,
  REMEDIAL_TYPE_LABELS,
} from '../components/labels';

export const dynamic = 'force-dynamic';

export default async function MaterialRemedialDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, REMEDIAL_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const { id } = await params;
  const canApprove = canAccess(session.user.roles, REMEDIAL_APPROVER_ROLES);

  return (
    <PageContainer>
      <Suspense fallback={<MaterialDetailFallback />}>
        <MaterialDetailSection id={id} canApprove={canApprove} />
      </Suspense>
    </PageContainer>
  );
}

async function MaterialDetailSection({ id, canApprove }: { id: string; canApprove: boolean }) {
  let material: RemedialMaterialModel | null = null;
  let loadError = false;
  try {
    material = await apiGet<RemedialMaterialModel>(`/remedial/${id}`);
  } catch {
    loadError = true;
  }

  if (loadError) {
    return (
      <>
        <PageHeader title="Material remedial" />
        <AlertCallout tone="danger" title="No se pudo cargar el material">
          No tienes acceso a este material o no existe.
        </AlertCallout>
      </>
    );
  }

  if (!material) notFound();

  const title =
    material.title ??
    `${REMEDIAL_TYPE_LABELS[material.type]} · ${material.nodeName ?? 'Sin habilidad'}`;

  const backLink = (
    <Link
      href={ROUTES.materialRemedial}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Volver al banco
    </Link>
  );

  const header = (
    <PageHeader
      title={title}
      description={`${REMEDIAL_TYPE_LABELS[material.type]}${material.nodeName ? ` · ${material.nodeName}` : ''}`}
      actions={
        <StatusBadge tone={REMEDIAL_STATUS_TONE[material.status]}>
          {REMEDIAL_STATUS_LABELS[material.status]}
        </StatusBadge>
      }
    />
  );

  // En curso: el cliente reconsulta GET /:id hasta salir de pending/processing.
  if (material.status === 'pending' || material.status === 'processing') {
    return (
      <>
        {backLink}
        {header}
        <RemedialPoller materialId={material.id} status={material.status} />
      </>
    );
  }

  if (material.status === 'failed') {
    return (
      <>
        {backLink}
        {header}
        <EmptyState
          icon={Sparkles}
          title="La generación no pudo completarse"
          description={
            material.error ??
            'Ocurrió un error al generar el material. Genera uno nuevo desde la brecha.'
          }
        />
      </>
    );
  }

  // ready/approved/discarded: renderizar el contenido EFECTIVO (§8.3: la edición
  // humana vive en `editedContent`; la salida IA en `content` es evidencia inmutable).
  const effectiveContent = material.editedContent ?? material.content;
  if (!effectiveContent) {
    return (
      <>
        {backLink}
        {header}
        <AlertCallout tone="warning">Este material no tiene contenido.</AlertCallout>
      </>
    );
  }

  let content: RemedialContent;
  try {
    content = validateRemedialContent(material.type, effectiveContent);
  } catch {
    return (
      <>
        {backLink}
        {header}
        <AlertCallout tone="danger" title="Formato inesperado">
          El contenido del material no pudo validarse.
        </AlertCallout>
      </>
    );
  }

  // Versión estudiante (TKT-17 b): mismo material, render sin la información
  // solo-profesor. Se deriva en backend desde el content efectivo.
  let studentMaterial: RemedialStudentMaterialModel | null = null;
  try {
    studentMaterial = await apiGet<RemedialStudentMaterialModel>(`/remedial/${id}/student`);
  } catch {
    studentMaterial = null;
  }

  return (
    <>
      {backLink}
      {header}
      <RemedialMaterialView
        material={material}
        teacherContent={content}
        studentContent={studentMaterial?.content ?? null}
        canApprove={canApprove}
        title={title}
      />
    </>
  );
}

function MaterialDetailFallback() {
  return (
    <>
      <Skeleton className="h-5 w-40" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-6 w-24" />
      </div>
      <CardSkeleton rows={6} />
    </>
  );
}
