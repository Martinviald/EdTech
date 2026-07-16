import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  canAccess,
  DASHBOARD_VIEWER_ROLES,
  ANALYTICS_VIEWER_ROLES,
  ITEM_ANALYSIS_VIEWER_ROLES,
  AI_ANALYSIS_VIEWER_ROLES,
  REMEDIAL_VIEWER_ROLES,
  INSTRUMENT_QUALITY_VIEWER_ROLES,
  OFFICIAL_REPORT_VIEWER_ROLES,
  capabilityUnavailableMessage,
  type AssessmentReportResponse,
  type InstrumentAttachmentModel,
} from '@soe/types';
import { PageContainer, PageHeader } from '@/components/patterns';
import { AskAiButton } from '@/components/assistant';
import { EnunciadoViewButton } from '@/components/instruments/EnunciadoViewButton';
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

  // PDF del enunciado del instrumento de esta evaluación (si existe). Se ofrece en
  // el encabezado del hub para abrirlo en una pestaña aparte y consultarlo junto a
  // los resultados. Falla en silencio (botón oculto) si el rol no puede leer el
  // instrumento o el almacenamiento no está configurado.
  let enunciadoPdf: InstrumentAttachmentModel | null = null;
  try {
    enunciadoPdf = await apiGet<InstrumentAttachmentModel | null>(
      `/instruments/${meta.instrumentId}/enunciado-pdf`,
    );
  } catch {
    enunciadoPdf = null;
  }

  // Disponibilidad por granularidad del dato (§4.4 del plan). El rol dice qué
  // pestañas PUEDE ver el usuario; `capabilities` dice cuáles tienen algo que
  // mostrar para ESTA evaluación. Se sirve desde el backend, no se deriva acá.
  //
  // Criterio de gating, distinto por pestaña según lo que quede en pie:
  // - `Calidad` requiere psicometría (KR-20, biserial), que no tiene sustituto
  //   agregado: sin `responses` la pestaña entera es un callejón sin salida →
  //   se deshabilita con el motivo a la vista (mismo patrón que
  //   `generate-panel.tsx`: apagar lo imposible y decir por qué), en vez de
  //   ocultarla, para que el hub no cambie de forma entre evaluaciones.
  // - `Detalle por pregunta` y `Análisis IA` NO se apagan: la primera conserva
  //   los agregados por pregunta y la segunda deja ver análisis ya generados.
  //   Lo que falta lo explica cada página en su propio cuerpo.
  const capabilities = meta.capabilities;
  const canSeeQuality = capabilities.includes('psychometrics');

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
      ? [
          {
            href: `${base}/calidad`,
            label: 'Calidad',
            disabled: !canSeeQuality,
            disabledReason: canSeeQuality
              ? undefined
              : capabilityUnavailableMessage('psychometrics'),
          },
        ]
      : []),
    ...(canAccess(roles, OFFICIAL_REPORT_VIEWER_ROLES)
      ? [{ href: `${base}/informe-oficial`, label: 'Informe oficial' }]
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
          <>
            {enunciadoPdf ? <EnunciadoViewButton instrumentId={meta.instrumentId} /> : null}
            <Link href={`/banco-items/${meta.instrumentId}/spec-table` as Route}>
              <Button variant="outline" size="sm">
                Tabla de especificaciones
              </Button>
            </Link>
            <AskAiButton prompt="Analiza esta evaluación: ¿qué cursos y habilidades están más descendidos y qué priorizar?" />
          </>
        }
      />

      <AssessmentTabsNav tabs={tabs} />

      {children}
    </PageContainer>
  );
}
