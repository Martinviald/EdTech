import Link from 'next/link';
import type { Route } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  TAXONOMY_ROLES,
  taxonomyKind,
  userHasRole,
  type TaxonomyTreeResponse,
} from '@soe/types';
import { TreeView } from './TreeView';

export default async function MarcoAcademicoDetailPage({
  params,
}: {
  params: Promise<{ taxonomyId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, TAXONOMY_ROLES)) redirect('/dashboard');

  const { taxonomyId } = await params;

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
    (taxonomy.orgId === session.user.orgId || userHasRole(session.user.roles, 'platform_admin'));

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href={'/marcos-academicos' as Route}
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
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200'
                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
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
    </div>
  );
}
