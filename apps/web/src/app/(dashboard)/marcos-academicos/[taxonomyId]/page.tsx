import { Suspense } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import { TableSkeleton } from '@/components/shared';
import { Skeleton } from '@/components/ui/skeleton';
import {
  canAccess,
  TAXONOMY_ROLES,
  taxonomyKind,
  userHasRole,
  type UserRole,
  type TaxonomyTreeResponse,
} from '@soe/types';
import { TreeView } from './TreeView';

export default async function MarcoAcademicoDetailPage({
  params,
}: {
  params: Promise<{ taxonomyId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, TAXONOMY_ROLES)) redirect(ROUTES.dashboard);

  const { taxonomyId } = await params;

  return (
    <div className="space-y-6">
      <Suspense fallback={<TaxonomyDetailSkeleton />}>
        <TaxonomyDetail
          taxonomyId={taxonomyId}
          orgId={session.user.orgId}
          roles={session.user.roles}
        />
      </Suspense>
    </div>
  );
}

async function TaxonomyDetail({
  taxonomyId,
  orgId,
  roles,
}: {
  taxonomyId: string;
  orgId: string | null;
  roles: readonly UserRole[];
}) {
  let data: TaxonomyTreeResponse;
  try {
    data = await apiGet<TaxonomyTreeResponse>(`/taxonomies/${taxonomyId}/tree`);
  } catch {
    notFound();
  }

  const { taxonomy, nodes } = data;
  const { groupLabel, typeLabel } = taxonomyKind(taxonomy.type, taxonomy.isOfficial);
  const editable =
    !taxonomy.isOfficial &&
    (taxonomy.orgId === orgId || userHasRole(roles, 'platform_admin'));

  return (
    <>
      <div className="space-y-2">
        <Link
          href={ROUTES.marcosAcademicos}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" /> Volver a marcos académicos
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold">{taxonomy.name}</h1>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  taxonomy.isOfficial
                    ? 'bg-info/10 text-info'
                    : 'bg-success/10 text-success'
                }`}
              >
                {taxonomy.isOfficial ? groupLabel : 'Propio del colegio'}
              </span>
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              {typeLabel}
              {taxonomy.version && ` · v${taxonomy.version}`} · {nodes.length} nodos
            </p>
          </div>
        </div>
        {!editable && (
          <p className="bg-muted text-muted-foreground rounded-md px-3 py-2 text-xs">
            Este marco académico es de solo lectura.{' '}
            {taxonomy.isOfficial
              ? 'Los marcos oficiales se mantienen desde el seed de la plataforma.'
              : 'Pertenece a otra organización.'}
          </p>
        )}
      </div>

      <TreeView taxonomyId={taxonomy.id} nodes={nodes} editable={editable} />
    </>
  );
}

function TaxonomyDetailSkeleton() {
  return (
    <>
      <Skeleton className="h-4 w-52" />
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <TableSkeleton rows={8} />
    </>
  );
}
