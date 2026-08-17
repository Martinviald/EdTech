import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import {
  canAccess,
  validateRemedialContent,
  DOCUMENT_EDITOR_ROLES,
  REMEDIAL_VIEWER_ROLES,
  REMEDIAL_APPROVER_ROLES,
  type RemedialContent,
  type RemedialMaterialModel,
  type RemedialStudentMaterialModel,
} from '@soe/types';
import { Skeleton } from '@/components/ui/skeleton';
import {
  PageContainer,
  PageActions,
  EmptyState,
  AlertCallout,
  StatusBadge,
  CardSkeleton,
} from '@/components/shared';
import { SetPageTitle } from '@/components/layout/page-title-context';
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
  const canOpenInEditor = canAccess(session.user.roles, DOCUMENT_EDITOR_ROLES);

  return (
    <PageContainer>
      <Suspense fallback={<MaterialDetailFallback />}>
        <MaterialDetailSection id={id} canApprove={canApprove} canOpenInEditor={canOpenInEditor} />
      </Suspense>
    </PageContainer>
  );
}

async function MaterialDetailSection({
  id,
  canApprove,
  canOpenInEditor,
}: {
  id: string;
  canApprove: boolean;
  canOpenInEditor: boolean;
}) {
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

  // El título (nombre del material) lo pinta la barra superior; acá queda solo
  // el subtítulo de tipo/habilidad junto al estado.
  const header = (
    <>
      <SetPageTitle title={title} />
      <PageActions>
        <span className="mr-auto text-sm text-muted-foreground">
          {REMEDIAL_TYPE_LABELS[material.type]}
          {material.nodeName ? ` · ${material.nodeName}` : ''}
        </span>
        <StatusBadge tone={REMEDIAL_STATUS_TONE[material.status]}>
          {REMEDIAL_STATUS_LABELS[material.status]}
        </StatusBadge>
      </PageActions>
    </>
  );

  // En curso: el cliente reconsulta GET /:id hasta salir de pending/processing.
  if (material.status === 'pending' || material.status === 'processing') {
    return (
      <>
        {header}
        <RemedialPoller materialId={material.id} status={material.status} />
      </>
    );
  }

  if (material.status === 'failed') {
    return (
      <>
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
      {header}
      <RemedialMaterialView
        material={material}
        teacherContent={content}
        studentContent={studentMaterial?.content ?? null}
        canApprove={canApprove}
        canOpenInEditor={canOpenInEditor}
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
