import Link from 'next/link';
import type { Route } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  validateRemedialContent,
  REMEDIAL_VIEWER_ROLES,
  REMEDIAL_APPROVER_ROLES,
  type RemedialContent,
  type RemedialMaterialModel,
  type RemedialStudentMaterialModel,
} from '@soe/types';
import {
  PageContainer,
  PageHeader,
  EmptyState,
  AlertCallout,
  StatusBadge,
} from '@/components/patterns';
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
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, REMEDIAL_VIEWER_ROLES)) redirect('/dashboard');

  const { id } = await params;

  let material: RemedialMaterialModel | null = null;
  let loadError = false;
  try {
    material = await apiGet<RemedialMaterialModel>(`/remedial/${id}`);
  } catch {
    loadError = true;
  }

  if (loadError) {
    return (
      <PageContainer>
        <PageHeader title="Material remedial" />
        <AlertCallout tone="danger" title="No se pudo cargar el material">
          No tienes acceso a este material o no existe.
        </AlertCallout>
      </PageContainer>
    );
  }

  if (!material) notFound();

  const canApprove = canAccess(session.user.roles, REMEDIAL_APPROVER_ROLES);
  const title =
    material.title ??
    `${REMEDIAL_TYPE_LABELS[material.type]} · ${material.nodeName ?? 'Sin habilidad'}`;

  const backLink = (
    <Link
      href={'/material-remedial' as Route}
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
      <PageContainer>
        {backLink}
        {header}
        <RemedialPoller materialId={material.id} status={material.status} />
      </PageContainer>
    );
  }

  if (material.status === 'failed') {
    return (
      <PageContainer>
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
      </PageContainer>
    );
  }

  // ready/approved/discarded: renderizar el contenido EFECTIVO (§8.3: la edición
  // humana vive en `editedContent`; la salida IA en `content` es evidencia inmutable).
  const effectiveContent = material.editedContent ?? material.content;
  if (!effectiveContent) {
    return (
      <PageContainer>
        {backLink}
        {header}
        <AlertCallout tone="warning">Este material no tiene contenido.</AlertCallout>
      </PageContainer>
    );
  }

  let content: RemedialContent;
  try {
    content = validateRemedialContent(material.type, effectiveContent);
  } catch {
    return (
      <PageContainer>
        {backLink}
        {header}
        <AlertCallout tone="danger" title="Formato inesperado">
          El contenido del material no pudo validarse.
        </AlertCallout>
      </PageContainer>
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
    <PageContainer>
      {backLink}
      {header}
      <RemedialMaterialView
        material={material}
        teacherContent={content}
        studentContent={studentMaterial?.content ?? null}
        canApprove={canApprove}
        title={title}
      />
    </PageContainer>
  );
}
