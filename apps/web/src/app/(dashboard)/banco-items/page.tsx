import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  canAccess,
  userHasAnyRole,
  ITEM_VIEWER_ROLES,
  ITEM_BANK_ROLES,
  type InstrumentModel,
} from '@soe/types';
import { InstrumentCard } from './InstrumentCard';
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Banco de Items</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Instrumentos de evaluacion, preguntas y pautas oficiales.
          </p>
        </div>
        {canCreate && (
          <Link href={'/banco-items/nuevo' as Route}>
            <Button>Nuevo instrumento</Button>
          </Link>
        )}
      </div>

      <InstrumentFilters />

      {instruments.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              No se encontraron instrumentos. {canCreate && 'Crea el primero.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {instruments.map((instrument) => (
              <InstrumentCard key={instrument.id} instrument={instrument} />
            ))}
          </div>
          {total > 20 && (
            <p className="text-center text-xs text-muted-foreground">
              Mostrando {instruments.length} de {total} instrumentos
            </p>
          )}
        </>
      )}
    </div>
  );
}
