import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { Inbox } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import {
  canAccess,
  INSTRUMENT_QUALITY_VIEWER_ROLES,
  type InstrumentQualityResponse,
} from '@soe/types';
import { EmptyState, KpiGridSkeleton, CardSkeleton } from '@/components/shared';
import { QualityPanel } from '../../../analisis-ia/components/quality-panel';

export const dynamic = 'force-dynamic';

function pickParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : undefined;
}

export default async function EvaluacionCalidadPage({
  params,
  searchParams,
}: {
  params: Promise<{ assessmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, INSTRUMENT_QUALITY_VIEWER_ROLES)) redirect(ROUTES.dashboard);

  const { assessmentId } = await params;
  const sp = await searchParams;
  const classGroupId = pickParam(sp.classGroupId);

  return (
    <Suspense fallback={<CalidadSkeleton />}>
      <CalidadContent assessmentId={assessmentId} classGroupId={classGroupId} />
    </Suspense>
  );
}

function CalidadSkeleton() {
  return (
    <div className="space-y-6">
      <KpiGridSkeleton count={3} />
      <CardSkeleton rows={6} />
    </div>
  );
}

async function CalidadContent({
  assessmentId,
  classGroupId,
}: {
  assessmentId: string;
  classGroupId: string | undefined;
}) {
  const query = new URLSearchParams({ assessmentId });
  if (classGroupId) query.set('classGroupId', classGroupId);

  let quality: InstrumentQualityResponse | null = null;
  try {
    quality = await apiGet<InstrumentQualityResponse>(`/instrument-quality?${query.toString()}`);
  } catch {
    quality = null;
  }

  return (
    <div className="space-y-6">
      {quality ? (
        <QualityPanel quality={quality} />
      ) : (
        <EmptyState
          icon={Inbox}
          title="No se pudo cargar la calidad del instrumento"
          description="No hay datos suficientes para el curso seleccionado o no tienes acceso. Ajusta el filtro de curso o verifica tus cursos asignados."
        />
      )}
    </div>
  );
}
