import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { PenSquare } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import {
  canAccess,
  DOCUMENT_VIEWER_ROLES,
  REMEDIAL_VIEWER_ROLES,
  type CatalogEntryModel,
  type MaterialLibraryResponse,
  type UserRole,
} from '@soe/types';
import { isFeatureEnabled } from '@/lib/features';
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
import { RemedialLibraryRow } from './remedial-library-row';

type SearchParams = Record<string, string | string[] | undefined>;

const PAGE_SIZE = 20;

const FILTER_KEYS = ['origin', 'review', 'type', 'status', 'subjectId', 'gradeId', 'mine'] as const;

function buildLibraryQuery(params: SearchParams, page: string): string {
  const query = new URLSearchParams({ page, pageSize: String(PAGE_SIZE) });
  for (const key of FILTER_KEYS) {
    const value = params[key];
    if (typeof value === 'string' && value) query.set(key, value);
  }
  return query.toString();
}

function hasActiveFilters(params: SearchParams): boolean {
  return FILTER_KEYS.some((key) => typeof params[key] === 'string' && params[key] !== '');
}

/**
 * Biblioteca unificada de Materiales: documentos por bloques del colegio y material
 * remedial generado por IA (docs/diseno/rediseno-navegacion.md §5). Un remedial que ya
 * se abrió en el editor se lista una sola vez, como documento.
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
  const query = buildLibraryQuery(params, page);
  const filtered = hasActiveFilters(params);
  const roles = session.user.roles;

  return (
    <PageContainer>
      <PageHeader
        title="Materiales"
        description="Crea, edita y comparte guías y materiales imprimibles con la identidad de tu colegio."
        actions={<NewDocumentDialog />}
      />

      <Suspense fallback={<FiltersRowSkeleton />}>
        <FiltersSection roles={roles} />
      </Suspense>

      <Suspense fallback={<TableSkeleton />}>
        <LibrarySection
          query={query}
          page={Number(page)}
          filtered={filtered}
          currentUserId={session.user.id}
        />
      </Suspense>
    </PageContainer>
  );
}

async function FiltersSection({ roles }: { roles: readonly UserRole[] }) {
  const canSeeRemedial = canAccess(roles, REMEDIAL_VIEWER_ROLES);
  const [subjects, grades, remedialEnabled] = await Promise.all([
    apiGet<CatalogEntryModel[]>('/catalog/subjects'),
    apiGet<CatalogEntryModel[]>('/catalog/grades'),
    canSeeRemedial ? isFeatureEnabled('remedial') : Promise.resolve(false),
  ]);
  return (
    <DocumentFilters
      subjects={subjects}
      grades={grades}
      showReviewFilter={canSeeRemedial && remedialEnabled}
    />
  );
}

async function LibrarySection({
  query,
  page,
  filtered,
  currentUserId,
}: {
  query: string;
  page: number;
  filtered: boolean;
  currentUserId: string;
}) {
  const [{ data: entries, total }, subjects, grades] = await Promise.all([
    apiGet<MaterialLibraryResponse>(`/documents/library?${query}`),
    apiGet<CatalogEntryModel[]>('/catalog/subjects'),
    apiGet<CatalogEntryModel[]>('/catalog/grades'),
  ]);

  if (entries.length === 0 && filtered) {
    return (
      <EmptyState
        icon={PenSquare}
        title="No hay materiales con estos filtros"
        description="Prueba con otro origen, estado o asignatura."
      />
    );
  }

  if (entries.length === 0) {
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
        {entries.map((entry) =>
          entry.kind === 'document' ? (
            <DocumentRow
              key={`document-${entry.document.id}`}
              document={entry.document}
              origin={entry.origin}
              remedial={entry.remedial}
              currentUserId={currentUserId}
              catalogNames={catalogNames}
            />
          ) : (
            <RemedialLibraryRow key={`remedial-${entry.id}`} item={entry} />
          ),
        )}
      </div>
      <PaginationControls
        page={page}
        limit={PAGE_SIZE}
        total={total}
        basePath={ROUTES.materiales}
      />
    </>
  );
}

function FiltersRowSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Skeleton className="h-10 w-[220px]" />
      <Skeleton className="h-10 w-[190px]" />
      <Skeleton className="h-10 w-[150px]" />
      <Skeleton className="h-10 w-[180px]" />
      <Skeleton className="h-10 w-[160px]" />
      <Skeleton className="h-10 w-[150px]" />
    </div>
  );
}
