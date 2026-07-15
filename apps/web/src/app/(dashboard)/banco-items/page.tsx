import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { Library } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageContainer, PageHeader, EmptyState, PaginationControls } from '@/components/patterns';
import {
  canAccess,
  userHasAnyRole,
  ITEM_VIEWER_ROLES,
  ITEM_BANK_ROLES,
  type CatalogEntryModel,
  type InstrumentFacetsModel,
  type InstrumentModel,
} from '@soe/types';
import { InstrumentRow } from './InstrumentRow';
import { InstrumentFilters } from './InstrumentFilters';

type InstrumentListResponse = {
  data: InstrumentModel[];
  total: number;
  page: number;
  limit: number;
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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

export default async function BancoItemsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, ITEM_VIEWER_ROLES)) redirect('/dashboard');

  const params = await searchParams;
  const page = typeof params.page === 'string' ? params.page : '1';

  // `pageSize` (no `limit`) es el nombre que valida el DTO del API.
  const query = new URLSearchParams({ page, pageSize: String(PAGE_SIZE) });
  for (const key of FILTER_KEYS) {
    const value = params[key];
    if (typeof value === 'string' && value) query.set(key, value);
  }

  const [instrumentList, subjects, grades, facets] = await Promise.all([
    apiGet<InstrumentListResponse>(`/instruments?${query.toString()}`),
    apiGet<CatalogEntryModel[]>('/catalog/subjects'),
    apiGet<CatalogEntryModel[]>('/catalog/grades'),
    apiGet<InstrumentFacetsModel>('/instruments/facets'),
  ]);

  const { data: instruments, total } = instrumentList;
  const canCreate = userHasAnyRole(session.user.roles, ITEM_BANK_ROLES);

  return (
    <PageContainer>
      <PageHeader
        title="Banco de Instrumentos"
        description="Instrumentos de evaluación, preguntas y pautas oficiales."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={'/banco-items/explorar' as Route}>
              <Button variant="outline">Banco de ítems</Button>
            </Link>
            {canCreate ? (
              <Link href={'/banco-items/nuevo' as Route}>
                <Button>Nuevo instrumento</Button>
              </Link>
            ) : null}
          </div>
        }
      />

      <InstrumentFilters subjects={subjects} grades={grades} years={facets.years} />

      {instruments.length === 0 ? (
        <EmptyState
          icon={Library}
          title="No se encontraron instrumentos"
          description={
            canCreate
              ? 'Crea el primer instrumento para empezar a construir tu banco de ítems.'
              : 'Aún no hay instrumentos disponibles para tu colegio.'
          }
          action={
            canCreate ? (
              <Link href={'/banco-items/nuevo' as Route}>
                <Button>Nuevo instrumento</Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="divide-y overflow-hidden rounded-lg border">
            {instruments.map((instrument) => (
              <InstrumentRow key={instrument.id} instrument={instrument} />
            ))}
          </div>
          <PaginationControls
            page={Number(page)}
            limit={PAGE_SIZE}
            total={total}
            basePath="/banco-items"
          />
        </>
      )}
    </PageContainer>
  );
}
