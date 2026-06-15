import { redirect } from 'next/navigation';
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
import { PageContainer, PageHeader, EmptyState, AlertCallout } from '@/components/patterns';
import { FeatureUpgradeNotice } from '@/components/feature-gate';
import { isFeatureEnabled } from '@/lib/features';
import { RemedialFilters } from './components/remedial-filters';
import { MaterialCard } from './components/material-card';
import { GeneratePanel } from './components/generate-panel';
import { AI_DISCLAIMER } from './components/labels';

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

export default async function MaterialRemedialPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, REMEDIAL_VIEWER_ROLES)) redirect('/dashboard');
  if (!(await isFeatureEnabled('remedial'))) {
    return <FeatureUpgradeNotice feature="remedial" />;
  }

  const params = await searchParams;
  const nodeId = pickParam(params.nodeId);
  const nodeName = pickParam(params.nodeName);
  const assessmentId = pickParam(params.assessmentId);
  const classGroupId = pickParam(params.classGroupId);
  const sourceAnalysisId = pickParam(params.sourceAnalysisId);
  const filterType = parseType(pickParam(params.type));
  const filterStatus = parseStatus(pickParam(params.status));
  const generate = pickParam(params.generate) === '1';
  const pageRaw = pickParam(params.page);
  const page = pageRaw && /^\d+$/.test(pageRaw) ? Math.max(1, Number(pageRaw)) : 1;

  const header = (
    <PageHeader
      title="Material Remedial"
      description="Banco de material remedial generado por IA a partir de las brechas diagnosticadas: guías de reenseñanza, sets de práctica y planes por grupo. La IA propone; tú revisas y apruebas (H9.6)."
    />
  );

  // Modo "generar desde brecha": requiere ?nodeId=&generate=1 explícito (enlace
  // desde el Análisis IA). Sin `generate`, `type`/`nodeId` filtran el banco — así
  // filtrar por tipo nunca cae por error en modo generación.
  const presetType = filterType;
  if (nodeId && generate) {
    return (
      <PageContainer>
        {header}
        <GeneratePanel
          nodeId={nodeId}
          nodeName={nodeName}
          assessmentId={assessmentId}
          classGroupId={classGroupId}
          sourceAnalysisId={sourceAnalysisId}
          presetType={presetType}
        />
      </PageContainer>
    );
  }

  // Banco de material: lista paginada con filtros (tipo/estado/nodeId).
  const query = new URLSearchParams();
  query.set('page', String(page));
  query.set('limit', String(PAGE_SIZE));
  if (filterType) query.set('type', filterType);
  if (filterStatus) query.set('status', filterStatus);
  if (nodeId) query.set('nodeId', nodeId);

  let list: RemedialListResponse | null = null;
  let loadError = false;
  try {
    list = await apiGet<RemedialListResponse>(`/remedial?${query.toString()}`);
  } catch {
    loadError = true;
  }

  if (loadError || !list) {
    return (
      <PageContainer>
        {header}
        <AlertCallout tone="danger" title="No se pudo cargar el material">
          Ocurrió un error al cargar el banco de material remedial. Intenta nuevamente.
        </AlertCallout>
      </PageContainer>
    );
  }

  const totalPages = Math.max(1, Math.ceil(list.total / list.limit));

  return (
    <PageContainer>
      {header}

      <AlertCallout tone="info">{AI_DISCLAIMER}</AlertCallout>

      <RemedialFilters />

      {list.data.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Aún no hay material remedial"
          description="Genera material remedial desde una brecha diagnosticada en el Análisis IA para empezar a poblar tu banco."
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
    </PageContainer>
  );
}
