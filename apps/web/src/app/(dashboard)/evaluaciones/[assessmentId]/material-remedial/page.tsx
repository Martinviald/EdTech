import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  REMEDIAL_VIEWER_ROLES,
  remedialMaterialTypeSchema,
  remedialStatusSchema,
  type RemedialListResponse,
  type RemedialMaterialType,
  type RemedialStatus,
} from '@soe/types';
import { EmptyState, AlertCallout } from '@/components/patterns';
import { FeatureUpgradeNotice } from '@/components/feature-gate';
import { isFeatureEnabled } from '@/lib/features';
import { RemedialFilters } from '../../../material-remedial/components/remedial-filters';
import { MaterialCard } from '../../../material-remedial/components/material-card';
import { AI_DISCLAIMER } from '../../../material-remedial/components/labels';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

function pickParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : undefined;
}

function parseType(raw: string | undefined): RemedialMaterialType | undefined {
  const parsed = remedialMaterialTypeSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

function parseStatus(raw: string | undefined): RemedialStatus | undefined {
  const parsed = remedialStatusSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

export default async function EvaluacionMaterialRemedialPage({
  params,
  searchParams,
}: {
  params: Promise<{ assessmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, REMEDIAL_VIEWER_ROLES)) redirect('/dashboard');
  if (!(await isFeatureEnabled('remedial'))) {
    return <FeatureUpgradeNotice feature="remedial" />;
  }

  const { assessmentId } = await params;
  const sp = await searchParams;
  const filterType = parseType(pickParam(sp.type));
  const filterStatus = parseStatus(pickParam(sp.status));
  const pageRaw = pickParam(sp.page);
  const page = pageRaw && /^\d+$/.test(pageRaw) ? Math.max(1, Number(pageRaw)) : 1;
  const basePath = `/evaluaciones/${assessmentId}/material-remedial`;

  // Banco de material acotado a ESTA evaluación (assessmentId del path).
  const query = new URLSearchParams();
  query.set('page', String(page));
  query.set('limit', String(PAGE_SIZE));
  query.set('assessmentId', assessmentId);
  if (filterType) query.set('type', filterType);
  if (filterStatus) query.set('status', filterStatus);

  let list: RemedialListResponse | null = null;
  try {
    list = await apiGet<RemedialListResponse>(`/remedial?${query.toString()}`);
  } catch {
    list = null;
  }

  if (!list) {
    return (
      <div className="space-y-6">
        <AlertCallout tone="danger" title="No se pudo cargar el material">
          Ocurrió un error al cargar el material remedial de esta evaluación. Intenta nuevamente.
        </AlertCallout>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(list.total / list.limit));

  return (
    <div className="space-y-6">
      <AlertCallout tone="info">{AI_DISCLAIMER}</AlertCallout>

      <p className="text-sm text-muted-foreground">
        Material remedial de esta evaluación. El material nuevo se genera desde las brechas
        diagnosticadas en la pestaña{' '}
        <Link href={`/evaluaciones/${assessmentId}/analisis-ia`} className="font-medium underline">
          Análisis IA
        </Link>
        . ¿Buscas el banco completo?{' '}
        <Link href="/material-remedial" className="font-medium underline">
          Ver todo el banco
        </Link>
        .
      </p>

      <RemedialFilters basePath={basePath} />

      {list.data.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Aún no hay material para esta evaluación"
          description="Genera material remedial desde una brecha diagnosticada en el Análisis IA de esta evaluación."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.data.map((material) => (
              <MaterialCard key={material.id} material={material} />
            ))}
          </div>
          {totalPages > 1 ? (
            <p className="text-center text-sm text-muted-foreground">
              Página {list.page} de {totalPages} · {list.total} materiales
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
