import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import { Library } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, PaginationControls, TableSkeleton } from '@/components/shared';
import {
  canAccess,
  ITEM_VIEWER_ROLES,
  type CatalogEntryModel,
  type InstrumentFacetsModel,
  type InstrumentModel,
  type PaginatedResponse,
} from '@soe/types';
import { InstrumentRow } from '../InstrumentRow';
import { InstrumentFilters } from '../InstrumentFilters';

type InstrumentListResponse = PaginatedResponse<InstrumentModel>;

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  searchParams: Promise<SearchParams>;
};

const PAGE_SIZE = 20;

/** Filtros que el API acepta tal cual desde la querystring. */
const FILTER_KEYS = [
  'type',
  'status',
  'year',
  'subjectId',
  'gradeId',
  'applicationPeriod',
] as const;

function buildInstrumentsQuery(params: SearchParams, page: string): string {
  // `pageSize` (no `limit`) es el nombre que valida el DTO del API.
  const query = new URLSearchParams({ page, pageSize: String(PAGE_SIZE) });
  for (const key of FILTER_KEYS) {
    const value = params[key];
    if (typeof value === 'string' && value) query.set(key, value);
  }
  return query.toString();
}

export default async function BancoItemsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, ITEM_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const params = await searchParams;
  const page = typeof params.page === 'string' ? params.page : '1';
  const query = buildInstrumentsQuery(params, page);

  return (
    <>
      <Suspense fallback={<FiltersRowSkeleton />}>
        <FiltersSection />
      </Suspense>

      <Suspense fallback={<TableSkeleton />}>
        <InstrumentsSection query={query} page={Number(page)} />
      </Suspense>
    </>
  );
}

async function FiltersSection() {
  const [subjects, grades] = await Promise.all([
    apiGet<CatalogEntryModel[]>('/catalog/subjects'),
    apiGet<CatalogEntryModel[]>('/catalog/grades'),
  ]);
  const facets = await apiGet<InstrumentFacetsModel>('/instruments/facets');

  return <InstrumentFilters subjects={subjects} grades={grades} years={facets.years} />;
}

async function InstrumentsSection({ query, page }: { query: string; page: number }) {
  const { data: instruments, total } = await apiGet<InstrumentListResponse>(
    `/instruments?${query}`,
  );

  if (instruments.length === 0) {
    return (
      <EmptyState
        icon={Library}
        title="No se encontraron instrumentos"
        description="Aún no hay instrumentos disponibles para tu colegio. Se cargan al importar una prueba."
      />
    );
  }

  return (
    <>
      <div className="divide-y overflow-hidden rounded-lg border">
        {instruments.map((instrument) => (
          <InstrumentRow key={instrument.id} instrument={instrument} />
        ))}
      </div>
      <PaginationControls
        page={page}
        limit={PAGE_SIZE}
        total={total}
        basePath={ROUTES.bancoItems}
      />
    </>
  );
}

function FiltersRowSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Skeleton className="h-10 w-[160px]" />
      <Skeleton className="h-10 w-[180px]" />
      <Skeleton className="h-10 w-[160px]" />
      <Skeleton className="h-10 w-[130px]" />
      <Skeleton className="h-10 w-[160px]" />
    </div>
  );
}
