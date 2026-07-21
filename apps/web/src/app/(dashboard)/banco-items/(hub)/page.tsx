import { Suspense } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import { Library } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState, TableSkeleton } from '@/components/shared';
import {
  canAccess,
  userHasAnyRole,
  ITEM_VIEWER_ROLES,
  ITEM_BANK_ROLES,
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

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function buildInstrumentsQuery(params: Record<string, string | string[] | undefined>): string {
  const type = typeof params.type === 'string' ? params.type : undefined;
  const status = typeof params.status === 'string' ? params.status : undefined;
  const year = typeof params.year === 'string' ? params.year : undefined;
  const page = typeof params.page === 'string' ? params.page : '1';

  const queryParts: string[] = [`page=${page}`, 'limit=20'];
  if (type) queryParts.push(`type=${type}`);
  if (status) queryParts.push(`status=${status}`);
  if (year) queryParts.push(`year=${year}`);
  return queryParts.join('&');
}

export default async function BancoItemsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, ITEM_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const params = await searchParams;
  const query = buildInstrumentsQuery(params);
  const canCreate = userHasAnyRole(session.user.roles, ITEM_BANK_ROLES);

  const nuevoButton = canCreate ? (
    <Link href={ROUTES.bancoItemsNuevo}>
      <Button>Nuevo instrumento</Button>
    </Link>
  ) : null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <InstrumentFilters />
        {nuevoButton}
      </div>

      <Suspense fallback={<TableSkeleton />}>
        <InstrumentsSection query={query} canCreate={canCreate} nuevoButton={nuevoButton} />
      </Suspense>
    </>
  );
}

async function InstrumentsSection({
  query,
  canCreate,
  nuevoButton,
}: {
  query: string;
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
      {total > 20 && (
        <p className="text-center text-xs text-muted-foreground">
          Mostrando {instruments.length} de {total} instrumentos
        </p>
      )}
    </>
  );
}
