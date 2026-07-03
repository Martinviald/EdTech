import type { ReactNode } from 'react';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  DASHBOARD_VIEWER_ROLES,
  ANALYTICS_VIEWER_ROLES,
  ITEM_ANALYSIS_VIEWER_ROLES,
  AI_ANALYSIS_VIEWER_ROLES,
  REMEDIAL_VIEWER_ROLES,
  INSTRUMENT_QUALITY_VIEWER_ROLES,
  type AssessmentReportResponse,
} from '@soe/types';
import { PageContainer, PageHeader } from '@/components/patterns';
import { AskAiButton } from '@/components/assistant';
import { AssessmentTabsNav, type HubTab } from './components/assessment-tabs-nav';
import { HubAssistantContext } from './components/hub-assistant-context';

export const dynamic = 'force-dynamic';

function formatDate(value: string | Date | null): string | null {
  if (!value) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Layout del hub de evaluación. Carga la meta de la evaluación una sola vez
 * (`notFound()` si no existe o el usuario no tiene acceso), monta el contexto del
 * asistente para todas las pestañas y renderiza la sub-navegación con las
 * pestañas que el rol del usuario puede ver. Las páginas-pestaña leen el
 * `assessmentId` del path (`params`), no de la querystring.
 */
export default async function EvaluacionLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ assessmentId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, DASHBOARD_VIEWER_ROLES)) redirect('/dashboard');

  const { assessmentId } = await params;

  // Meta de la evaluación (nombre, instrumento, asignatura, grado, fecha, nº
  // alumnos). El endpoint comparte el conjunto de roles del hub
  // (RESULTS_VIEWER_ROLES), así que un 403/404 ⇒ sin acceso ⇒ notFound().
  let report: AssessmentReportResponse | null = null;
  try {
    report = await apiGet<AssessmentReportResponse>(
      `/analytics/assessment-report?assessmentId=${assessmentId}`,
    );
  } catch {
    notFound();
  }
  if (!report) notFound();

  const meta = report.meta;
  const roles = session.user.roles;
  const base = `/evaluaciones/${assessmentId}`;
  const title = meta.assessmentName ?? meta.instrumentName;

  const tabs: HubTab[] = [
    { href: base, label: 'Resumen', exact: true },
    ...(canAccess(roles, ANALYTICS_VIEWER_ROLES)
      ? [{ href: `${base}/resultados`, label: 'Resultados' }]
      : []),
    ...(canAccess(roles, ITEM_ANALYSIS_VIEWER_ROLES)
      ? [{ href: `${base}/detalle`, label: 'Detalle por pregunta' }]
      : []),
    ...(canAccess(roles, AI_ANALYSIS_VIEWER_ROLES)
      ? [{ href: `${base}/analisis-ia`, label: 'Análisis IA' }]
      : []),
    ...(canAccess(roles, REMEDIAL_VIEWER_ROLES)
      ? [{ href: `${base}/material-remedial`, label: 'Material remedial' }]
      : []),
    ...(canAccess(roles, INSTRUMENT_QUALITY_VIEWER_ROLES)
      ? [{ href: `${base}/calidad`, label: 'Calidad' }]
      : []),
  ];

  const date = formatDate(meta.administeredAt);
  // Sólo identidad de la evaluación (instrumento/asignatura/grado/fecha). El nº de
  // alumnos depende del filtro de curso y el layout no recibe `searchParams`, así
  // que no se muestra aquí para no contradecir los conteos del cuerpo (filtrados
  // por `classGroupId`). Esos conteos viven en cada pestaña.
  const description = [
    meta.instrumentName,
    [meta.subjectName, meta.gradeName].filter(Boolean).join(' · ') || null,
    date,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <PageContainer>
      {/* Contexto del asistente (E21) para todo el hub — una sola vez. */}
      <HubAssistantContext assessmentId={assessmentId} label={title} />

      <PageHeader
        title={title}
        description={description}
        actions={
          <AskAiButton prompt="Analiza esta evaluación: ¿qué cursos y habilidades están más descendidos y qué priorizar?" />
        }
      />

      <AssessmentTabsNav tabs={tabs} />

      {children}
    </PageContainer>
  );
}
