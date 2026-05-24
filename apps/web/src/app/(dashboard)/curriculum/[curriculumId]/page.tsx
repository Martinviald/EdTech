import Link from 'next/link';
import type { Route } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import type { CurriculumTreeResponse } from '@soe/types';
import { TreeView } from './TreeView';

const ALLOWED_ROLES = ['platform_admin', 'school_admin', 'academic_director'];

export default async function CurriculumDetailPage({
  params,
}: {
  params: Promise<{ curriculumId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!ALLOWED_ROLES.includes(session.user.role)) redirect('/dashboard');

  const { curriculumId } = await params;

  let data: CurriculumTreeResponse;
  try {
    data = await apiGet<CurriculumTreeResponse>(`/taxonomies/curricula/${curriculumId}/tree`);
  } catch {
    notFound();
  }

  const { curriculum, nodes } = data;
  const editable =
    !curriculum.isOfficial &&
    (curriculum.orgId === session.user.orgId || session.user.role === 'platform_admin');

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href={'/curriculum' as Route}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" /> Volver a currícula
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold">{curriculum.name}</h1>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  curriculum.isOfficial
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200'
                    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                }`}
              >
                {curriculum.isOfficial ? 'Oficial' : 'Custom'}
              </span>
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              {curriculum.type.toUpperCase()}
              {curriculum.version && ` · v${curriculum.version}`} · {nodes.length} nodos
            </p>
          </div>
        </div>
        {!editable && (
          <p className="bg-muted text-muted-foreground rounded-md px-3 py-2 text-xs">
            Este currículum es de solo lectura.{' '}
            {curriculum.isOfficial
              ? 'Los currícula oficiales se mantienen desde el seed de la plataforma.'
              : 'Pertenece a otra organización.'}
          </p>
        )}
      </div>

      <TreeView curriculumId={curriculum.id} nodes={nodes} editable={editable} />
    </div>
  );
}
