import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ListChecks } from 'lucide-react';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import { canAccess, ITEM_BANK_ROLES, ITEM_VIEWER_ROLES } from '@soe/types';
import { EmptyState, PaginationControls, TableSkeleton } from '@/components/shared';
import { Badge } from '@/components/ui/badge';
import { getCollections } from './data';
import { NewCollectionButton } from './NewCollectionButton';

const PAGE_SIZE = 50;

type SearchParams = Record<string, string | string[] | undefined>;
type PageProps = { searchParams: Promise<SearchParams> };

export default async function ColeccionesPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, ITEM_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const params = await searchParams;
  const page = typeof params.page === 'string' ? Math.max(1, Number(params.page) || 1) : 1;
  const canManage = canAccess(session.user.roles, ITEM_BANK_ROLES);

  return (
    <>
      {canManage && (
        <div className="flex justify-end">
          <NewCollectionButton />
        </div>
      )}

      <Suspense fallback={<TableSkeleton />}>
        <CollectionsSection page={page} canManage={canManage} />
      </Suspense>
    </>
  );
}

async function CollectionsSection({ page, canManage }: { page: number; canManage: boolean }) {
  const query = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  const { data, total } = await getCollections(query.toString());

  if (data.length === 0) {
    return (
      <EmptyState
        icon={ListChecks}
        title="Aún no hay listas"
        description={
          canManage
            ? 'Crea una lista para agrupar ítems y armar evaluaciones. También puedes seleccionar ítems desde la pestaña Ítems y guardarlos en una lista.'
            : 'Tu colegio aún no tiene listas de ítems.'
        }
      />
    );
  }

  return (
    <>
      <ul className="divide-y overflow-hidden rounded-lg border">
        {data.map((collection) => (
          <li key={collection.id}>
            <Link
              href={ROUTES.bancoColeccion(collection.id)}
              className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/50"
            >
              <div className="min-w-0 space-y-1">
                <p className="truncate font-medium">{collection.name}</p>
                {collection.description && (
                  <p className="truncate text-sm text-muted-foreground">{collection.description}</p>
                )}
              </div>
              <Badge variant="secondary" className="shrink-0">
                {collection.itemCount} ítem{collection.itemCount === 1 ? '' : 's'}
              </Badge>
            </Link>
          </li>
        ))}
      </ul>
      <PaginationControls
        page={page}
        limit={PAGE_SIZE}
        total={total}
        basePath={ROUTES.bancoColecciones}
      />
    </>
  );
}
