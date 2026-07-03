import { redirect } from 'next/navigation';
import type { Route } from 'next';

export const dynamic = 'force-dynamic';

function pickParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : undefined;
}

/**
 * Compatibilidad: el Análisis IA se movió al hub
 * `/evaluaciones/[assessmentId]/analisis-ia`. Con `assessmentId` en la query
 * (links/marcadores antiguos, asistente E21, launchpad del banco remedial) se
 * redirige al hub conservando `analysisId`/`classGroupId`; sin él, a la lista de
 * evaluaciones (el nuevo selector).
 *
 * Los componentes de presentación (`analysis-report`, `analysis-poller`,
 * `generate-button`, `quality-panel`, `actions.ts`, …) siguen viviendo en esta
 * carpeta: el hub los reutiliza.
 */
export default async function AnalisisIaRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const assessmentId = pickParam(params.assessmentId);
  const analysisId = pickParam(params.analysisId);
  const classGroupId = pickParam(params.classGroupId);

  if (assessmentId) {
    const qs = new URLSearchParams();
    if (analysisId) qs.set('analysisId', analysisId);
    if (classGroupId) qs.set('classGroupId', classGroupId);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    redirect(`/evaluaciones/${assessmentId}/analisis-ia${suffix}` as Route);
  }

  redirect(
    (classGroupId ? `/evaluaciones?classGroupId=${classGroupId}` : '/evaluaciones') as Route,
  );
}
