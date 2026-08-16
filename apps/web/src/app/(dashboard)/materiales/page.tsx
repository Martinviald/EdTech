import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { PenSquare } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import {
  canAccess,
  DOCUMENT_VIEWER_ROLES,
  type CatalogEntryModel,
  type DocumentListResponse,
} from '@soe/types';
import { Skeleton } from '@/components/ui/skeleton';
import {
  EmptyState,
  PageContainer,
  PageHeader,
  PaginationControls,
  TableSkeleton,
} from '@/components/shared';
import { DocumentFilters } from './document-filters';
import { DocumentRow } from './document-row';
import { NewDocumentDialog } from './new-document-dialog';

type SearchParams = Record<string, string | string[] | undefined>;

const PAGE_SIZE = 20;

const FILTER_KEYS = ['type', 'status', 'subjectId', 'gradeId', 'mine'] as const;

function buildDocumentsQuery(params: SearchParams, page: string): string {
  const query = new URLSearchParams({ page, pageSize: String(PAGE_SIZE) });
  for (const key of FILTER_KEYS) {
    const value = params[key];
    if (typeof value === 'string' && value) query.set(key, value);
  }
  return query.toString();
}

/**
 * Biblioteca del Editor de Materiales: documentos por bloques del colegio
 * (guías, ejercitación, versiones imprimibles). Ver docs/propuesta-editor-materiales.md.
 */
export default async function MaterialesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, DOCUMENT_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const params = await searchParams;
  const page = typeof params.page === 'string' ? params.page : '1';
  const query = buildDocumentsQuery(params, page);

  return (
    <PageContainer>
      <PageHeader
        title="Materiales"
        description="Crea, edita y comparte guías y materiales imprimibles con la identidad de tu colegio."
        actions={<NewDocumentDialog />}
      />

      <Suspense fallback={<FiltersRowSkeleton />}>
        <FiltersSection />
      </Suspense>

      <Suspense fallback={<TableSkeleton />}>
        <DocumentsSection query={query} page={Number(page)} currentUserId={session.user.id} />
      </Suspense>
    </PageContainer>
  );
}

async function FiltersSection() {
  const [subjects, grades] = await Promise.all([
    apiGet<CatalogEntryModel[]>('/catalog/subjects'),
    apiGet<CatalogEntryModel[]>('/catalog/grades'),
  ]);
  return <DocumentFilters subjects={subjects} grades={grades} />;
}

async function DocumentsSection({
  query,
  page,
  currentUserId,
}: {
  query: string;
  page: number;
  currentUserId: string;
}) {
  const [{ data: documents, total }, subjects, grades] = await Promise.all([
    apiGet<DocumentListResponse>(`/documents?${query}`),
    apiGet<CatalogEntryModel[]>('/catalog/subjects'),
    apiGet<CatalogEntryModel[]>('/catalog/grades'),
  ]);

  if (documents.length === 0) {
    return (
      <EmptyState
        icon={PenSquare}
        title="Aún no hay materiales"
        description="Crea tu primer material desde cero, o abre un material remedial aprobado en el editor."
        action={<NewDocumentDialog />}
      />
    );
  }

  const catalogNames: Record<string, string> = {};
  for (const entry of [...subjects, ...grades]) {
    catalogNames[entry.id] = entry.name;
  }

  return (
    <>
      <div className="divide-y overflow-hidden rounded-lg border">
        {documents.map((document) => (
          <DocumentRow
            key={document.id}
            document={document}
            currentUserId={currentUserId}
            catalogNames={catalogNames}
          />
        ))}
      </div>
      <PaginationControls page={page} limit={PAGE_SIZE} total={total} basePath={ROUTES.materiales} />
    </>
  );
}

function FiltersRowSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Skeleton className="h-10 w-[190px]" />
      <Skeleton className="h-10 w-[150px]" />
      <Skeleton className="h-10 w-[180px]" />
      <Skeleton className="h-10 w-[160px]" />
      <Skeleton className="h-10 w-[150px]" />
    </div>
  );
}
