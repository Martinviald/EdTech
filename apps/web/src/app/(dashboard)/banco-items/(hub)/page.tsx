import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import { Library } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, PaginationControls, TableSkeleton } from '@/components/shared';
import {
  canAccess,
  userHasAnyRole,
  ITEM_VIEWER_ROLES,
  ITEM_BANK_ROLES,
  type CatalogEntryModel,
  type InstrumentFacetsModel,
  type InstrumentModel,
} from '@soe/types';
import { InstrumentRow } from '../InstrumentRow';
import { InstrumentFilters } from '../InstrumentFilters';

type InstrumentListResponse = {
  data: InstrumentModel[];
  total: number;
  page: number;
  limit: number;
};

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  searchParams: Promise<SearchParams>;
};

const PAGE_SIZE = 20;

/** Filtros que el API acepta tal cual desde la querystring. */
const FILTER_KEYS = ['type', 'status', 'year', 'subjectId', 'gradeId', 'applicationPeriod'] as const;

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
  const canCreate = userHasAnyRole(session.user.roles, ITEM_BANK_ROLES);

  const nuevoButton = canCreate ? (
    <Link href={ROUTES.bancoItemsNuevo}>
      <Button>Nuevo instrumento</Button>
    </Link>
  ) : null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Suspense fallback={<FiltersRowSkeleton />}>
          <FiltersSection />
        </Suspense>
        {nuevoButton}
      </div>

      <Suspense fallback={<TableSkeleton />}>
        <InstrumentsSection
          query={query}
          page={Number(page)}
          canCreate={canCreate}
          nuevoButton={nuevoButton}
        />
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

async function InstrumentsSection({
  query,
  page,
  canCreate,
  nuevoButton,
}: {
  query: string;
  page: number;
  canCreate: boolean;
  nuevoButton: React.ReactNode;
}) {
  const { data: instruments, total } = await apiGet<InstrumentListResponse>(
    `/instruments?${query}`,
  );

  if (instruments.length === 0) {
    return (
      <EmptyState
        icon={Library}
        title="No se encontraron instrumentos"
        description={
          canCreate
            ? 'Crea el primer instrumento para empezar a construir tu banco de ítems.'
            : 'Aún no hay instrumentos disponibles para tu colegio.'
        }
        action={nuevoButton}
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
