import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { Library } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageContainer, PageHeader, EmptyState } from '@/components/patterns';
import {
  canAccess,
  userHasAnyRole,
  ITEM_VIEWER_ROLES,
  ITEM_BANK_ROLES,
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

export default async function BancoItemsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, ITEM_VIEWER_ROLES)) redirect('/dashboard');

  const params = await searchParams;
  const type = typeof params.type === 'string' ? params.type : undefined;
  const status = typeof params.status === 'string' ? params.status : undefined;
  const year = typeof params.year === 'string' ? params.year : undefined;
  const page = typeof params.page === 'string' ? params.page : '1';

  const queryParts: string[] = [`page=${page}`, 'limit=20'];
  if (type) queryParts.push(`type=${type}`);
  if (status) queryParts.push(`status=${status}`);
  if (year) queryParts.push(`year=${year}`);

  const { data: instruments, total } = await apiGet<InstrumentListResponse>(
    `/instruments?${queryParts.join('&')}`,
  );

  const canCreate = userHasAnyRole(session.user.roles, ITEM_BANK_ROLES);

  return (
    <PageContainer>
      <PageHeader
        title="Banco de Instrumentos"
        description="Instrumentos de evaluación, preguntas y pautas oficiales."
        actions={
          canCreate ? (
            <Link href={'/banco-items/nuevo' as Route}>
              <Button>Nuevo instrumento</Button>
            </Link>
          ) : null
        }
      />

      <InstrumentFilters />

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
          {total > 20 && (
            <p className="text-center text-xs text-muted-foreground">
              Mostrando {instruments.length} de {total} instrumentos
            </p>
          )}
        </>
      )}
    </PageContainer>
  );
}
