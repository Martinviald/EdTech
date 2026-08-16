import { Suspense } from 'react';
import { notFound, redirect } from 'next/navigation';
import { canAccess, DOCUMENT_VIEWER_ROLES, type DocumentModel } from '@soe/types';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import { PageContainer, PageHeader } from '@/components/shared';
import { DOCUMENT_STATUS_LABELS, DOCUMENT_TYPE_LABELS } from '../labels';
import { DocumentEditorShell } from './document-editor-shell';
import { EditorBodySkeleton } from './loading';

export default async function MaterialEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, DOCUMENT_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const { id } = await params;

  return (
    <PageContainer>
      <Suspense fallback={<EditorBodySkeleton />}>
        <DocumentSection id={id} />
      </Suspense>
    </PageContainer>
  );
}

async function DocumentSection({ id }: { id: string }) {
  let document: DocumentModel | null = null;
  try {
    document = await apiGet<DocumentModel>(`/documents/${id}`);
  } catch {
    notFound();
  }
  if (!document) notFound();

  return (
    <>
      <PageHeader
        title={document.title}
        description={`${DOCUMENT_TYPE_LABELS[document.type]} · ${DOCUMENT_STATUS_LABELS[document.status]}`}
      />
      <DocumentEditorShell document={document} />
    </>
  );
}
