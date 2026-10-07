import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { auth } from '@/auth';
import { ROUTES } from '@/lib/routes';
import {
  canAccess,
  REMEDIAL_VIEWER_ROLES,
  remedialMaterialTypeSchema,
  type RemedialMaterialType,
} from '@soe/types';
import { PageContainer, AlertCallout } from '@/components/shared';
import { FeatureUpgradeNotice } from '@/components/feature-gate';
import { isFeatureEnabled } from '@/lib/features';
import { GeneratePanel } from './components/generate-panel';

export const dynamic = 'force-dynamic';

function pickParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : undefined;
}

function parseType(raw: string | undefined): RemedialMaterialType | undefined {
  const parsed = remedialMaterialTypeSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * El listado de material remedial vive en la biblioteca unificada
 * (`/materiales?origin=remedial`, docs/diseno/rediseno-navegacion.md §5). Esta ruta
 * sólo conserva el flujo de generación desde una brecha (`?nodeId=&generate=1`,
 * enlazado desde el Análisis IA); cualquier otra visita redirige a la biblioteca.
 */
export default async function MaterialRemedialPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, REMEDIAL_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  if (!(await isFeatureEnabled('remedial'))) {
    return <FeatureUpgradeNotice feature="remedial" />;
  }

  const params = await searchParams;
  const generate = pickParam(params.generate) === '1';
  if (!generate) {
    const libraryQuery = new URLSearchParams({ origin: 'remedial' });
    if (pickParam(params.status) === 'ready') libraryQuery.set('review', 'pending_review');
    redirect(`${ROUTES.materiales}?${libraryQuery.toString()}` as Route);
  }

  const nodeId = pickParam(params.nodeId);
  if (!nodeId) {
    return (
      <PageContainer>
        <AlertCallout tone="info" title="Elige una brecha para generar material">
          El material remedial se genera desde una brecha diagnosticada. Abre el{' '}
          <Link href={ROUTES.analisisIa} className="font-medium underline">
            Análisis IA
          </Link>{' '}
          de una evaluación y usa “Generar material remedial” en la brecha que quieras trabajar.
        </AlertCallout>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <GeneratePanel
        nodeId={nodeId}
        nodeName={pickParam(params.nodeName)}
        assessmentId={pickParam(params.assessmentId)}
        classGroupId={pickParam(params.classGroupId)}
        sourceAnalysisId={pickParam(params.sourceAnalysisId)}
        presetType={parseType(pickParam(params.type))}
      />
    </PageContainer>
  );
}
