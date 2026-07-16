import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { Inbox, ShieldOff } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { asCapabilityUnavailable } from '@/lib/errors';
import { assessmentSupports } from '@/lib/assessment-capabilities';
import {
  canAccess,
  capabilityUnavailableMessage,
  INSTRUMENT_QUALITY_VIEWER_ROLES,
  type InstrumentQualityResponse,
} from '@soe/types';
import { EmptyState } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { QualityPanel } from '../../../analisis-ia/components/quality-panel';

export const dynamic = 'force-dynamic';

function pickParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : undefined;
}

/**
 * Estado de "la psicometría no aplica a esta evaluación". Cierra la pestaña
 * entera: sin `responses` no hay ScoreMatrix, y KR-20 / punto-biserial /
 * discriminación no tienen sustituto agregado.
 *
 * Es lo contrario de dejarla degradar: degradar acá no muestra un vacío,
 * **afirma mala calidad** (KR-20 "—" con badge warning, flags `misaligned`
 * inflados) sobre datos que nunca existieron.
 *
 * El texto sale de `capabilityUnavailableMessage` o del `message` del 409 — el
 * backend decide y explica, la web solo lo muestra. Sin copy paralelo.
 */
function QualityUnavailable({ reason, assessmentId }: { reason: string; assessmentId: string }) {
  return (
    <EmptyState
      icon={ShieldOff}
      title="El análisis de calidad no aplica a esta evaluación"
      description={reason}
      action={
        <Button asChild variant="outline" size="sm">
          <Link href={`/evaluaciones/${assessmentId}/resultados` as Route}>Ver resultados</Link>
        </Button>
      }
    />
  );
}

export default async function EvaluacionCalidadPage({
  params,
  searchParams,
}: {
  params: Promise<{ assessmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, INSTRUMENT_QUALITY_VIEWER_ROLES)) redirect('/dashboard');

  const { assessmentId } = await params;
  const sp = await searchParams;
  const classGroupId = pickParam(sp.classGroupId);

  // Gating por capacidad ANTES de pedir la calidad. El layout ya apagó la pestaña,
  // pero se llega por URL directa; además evita un fetch condenado al 409.
  if (!(await assessmentSupports(assessmentId, 'psychometrics'))) {
    return (
      <div className="space-y-6">
        <QualityUnavailable
          reason={capabilityUnavailableMessage('psychometrics')}
          assessmentId={assessmentId}
        />
      </div>
    );
  }

  const query = new URLSearchParams({ assessmentId });
  if (classGroupId) query.set('classGroupId', classGroupId);

  let quality: InstrumentQualityResponse | null = null;
  let unavailableReason: string | null = null;
  try {
    quality = await apiGet<InstrumentQualityResponse>(`/instrument-quality?${query.toString()}`);
  } catch (error) {
    // 409 del `CapabilityGuard` ⇒ no es un fallo, es "no aplica" con motivo.
    unavailableReason = asCapabilityUnavailable(error)?.message ?? null;
  }

  return (
    <div className="space-y-6">
      {quality ? (
        <QualityPanel quality={quality} />
      ) : unavailableReason ? (
        <QualityUnavailable reason={unavailableReason} assessmentId={assessmentId} />
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
