import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { Sparkles, ClipboardList, Lightbulb } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  AI_ANALYSIS_VIEWER_ROLES,
  INSTRUMENT_QUALITY_VIEWER_ROLES,
  REMEDIAL_VIEWER_ROLES,
  assessmentInsightsOutputSchema,
  type AiAnalysisModel,
  type AssessmentInsightsOutput,
  type AssessmentListResponse,
  type DashboardFilterOptionsResponse,
  type InstrumentQualityResponse,
  type ItemMatrixResponse,
  type MatrixQuestionColumn,
} from '@soe/types';
import { PageContainer, PageHeader, EmptyState } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { FeatureUpgradeNotice } from '@/components/feature-gate';
import { AskAiButton, RegisterAssistantContext } from '@/components/assistant';
import { isFeatureEnabled } from '@/lib/features';
import { DashboardFilterBar } from '../resultados/components/dashboard-filter-bar';
import {
  parseDashboardFilters,
  buildDashboardQuery,
} from '../resultados/components/dashboard-filters';
import { AssessmentSelect } from '../resultados/detalle/assessment-select';
import { GenerateButton } from './components/generate-button';
import { AnalysisPoller } from './components/analysis-poller';
import { AnalysisReport } from './components/analysis-report';

export const dynamic = 'force-dynamic';

function pickParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : undefined;
}

export default async function AnalisisIaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, AI_ANALYSIS_VIEWER_ROLES)) redirect('/dashboard');
  if (!(await isFeatureEnabled('ai_analysis'))) {
    return <FeatureUpgradeNotice feature="ai_analysis" />;
  }

  const activeRole = session.user.activeRole;
  // Audiencia del informe: igual que la usada al generar (entra al `inputHash`). Un
  // profesor ve la versión 'teacher'; el resto, 'director'.
  const audience = activeRole === 'teacher' ? 'teacher' : 'director';

  const params = await searchParams;
  const assessmentId = pickParam(params.assessmentId);
  const analysisId = pickParam(params.analysisId);
  const classGroupId = pickParam(params.classGroupId);

  const header = (
    <PageHeader
      title="Análisis IA"
      description="Informe pedagógico generado por IA a partir de las métricas de una evaluación: síntesis ejecutiva, ítems destacados y críticos, brechas por habilidad y recomendaciones priorizadas (E20 — H20.2 a H20.7)."
    />
  );

  // Sin evaluación seleccionada: en vez de un callejón sin salida, ofrecer aquí
  // mismo el selector de evaluación (mismo patrón que el Informe de evaluación).
  // El análisis se genera para una evaluación específica; al elegirla se vuelve a
  // esta página con `?assessmentId=` y se ofrece generar el análisis.
  if (!assessmentId) {
    const filters = parseDashboardFilters(params);
    const filterQuery = buildDashboardQuery(filters);
    const [options, assessmentList] = await Promise.all([
      apiGet<DashboardFilterOptionsResponse>(`/dashboards/filters${filterQuery}`),
      apiGet<AssessmentListResponse>(`/item-analysis/assessments${filterQuery}`),
    ]);

    return (
      <PageContainer>
        {header}
        <DashboardFilterBar options={options} value={filters} basePath="/analisis-ia" />
        <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
          <AssessmentSelect options={assessmentList.data} basePath="/analisis-ia" />
        </div>
        <EmptyState
          icon={ClipboardList}
          title="Selecciona una evaluación"
          description="Elige una evaluación con resultados para generar su análisis IA. También puedes llegar aquí desde el Informe de evaluación o la pestaña Análisis IA de Resultados con la evaluación ya cargada."
        />
      </PageContainer>
    );
  }

  // Resolver el análisis: por `analysisId` explícito (recién generado / polling) o,
  // si no viene, buscando el ÚLTIMO ya existente para esta evaluación. Esto último
  // arregla que al re-seleccionar la evaluación no se cargara el informe ya creado.
  let analysis: AiAnalysisModel | null = null;
  let loadError = false;
  if (analysisId) {
    try {
      analysis = await apiGet<AiAnalysisModel>(`/ai-analysis/${analysisId}`);
    } catch {
      loadError = true;
    }
  } else {
    const latestQuery = new URLSearchParams({ audience });
    if (classGroupId) latestQuery.set('classGroupId', classGroupId);
    analysis = await apiGet<AiAnalysisModel | null>(
      `/ai-analysis/assessments/${assessmentId}/latest?${latestQuery.toString()}`,
    ).catch(() => null);
  }

  // Vino `analysisId` pero no se pudo cargar (sin acceso / no existe).
  if (loadError) {
    return (
      <PageContainer>
        {header}
        <EmptyState
          icon={Sparkles}
          title="No se pudo cargar el análisis"
          description="No tienes acceso a este análisis o no existe. Puedes generar uno nuevo."
          action={
            <GenerateButton
              assessmentId={assessmentId}
              classGroupId={classGroupId}
              audience={audience}
            />
          }
        />
      </PageContainer>
    );
  }

  // No hay ningún análisis para esta evaluación todavía → ofrecer generarlo.
  if (!analysis) {
    return (
      <PageContainer>
        {header}
        <EmptyState
          icon={Sparkles}
          title="Aún no hay análisis para esta evaluación"
          description="Genera un informe IA que interpreta las métricas de la evaluación y propone acciones concretas. El proceso es asíncrono y puede tomar algunos segundos."
          action={
            <GenerateButton
              assessmentId={assessmentId}
              classGroupId={classGroupId}
              audience={audience}
            />
          }
        />
      </PageContainer>
    );
  }

  // En curso: el cliente reconsulta GET /:id hasta completed/failed.
  if (analysis.status === 'pending' || analysis.status === 'processing') {
    return (
      <PageContainer>
        {header}
        <AnalysisPoller analysisId={analysis.id} status={analysis.status} />
      </PageContainer>
    );
  }

  if (analysis.status === 'failed') {
    return (
      <PageContainer>
        {header}
        <EmptyState
          icon={Sparkles}
          title="El análisis no pudo completarse"
          description={
            analysis.error ??
            'Ocurrió un error al generar el análisis. Intenta generarlo nuevamente.'
          }
          action={
            <GenerateButton
              assessmentId={assessmentId}
              classGroupId={classGroupId}
              audience={audience}
              force
              label="Reintentar"
            />
          }
        />
      </PageContainer>
    );
  }

  // completed → validar/parsear el output con el schema compartido.
  const parsed = assessmentInsightsOutputSchema.safeParse(analysis.output);
  if (!parsed.success) {
    return (
      <PageContainer>
        {header}
        <EmptyState
          icon={Sparkles}
          title="El análisis tiene un formato inesperado"
          description="La salida del análisis no pudo validarse. Genera uno nuevo para reintentar."
          action={
            <GenerateButton
              assessmentId={assessmentId}
              classGroupId={classGroupId}
              audience={audience}
              force
              label="Regenerar"
            />
          }
        />
      </PageContainer>
    );
  }

  const output: AssessmentInsightsOutput = parsed.data;

  // Datos deterministas complementarios para el informe consolidado (H20.9/H20.11)
  // y el drill-down por-pregunta (H20.8). Best-effort: si fallan, el informe IA se
  // muestra igual (la calidad queda como null y el selector de ítems vacío).
  const qualityQuery = new URLSearchParams({ assessmentId });
  if (classGroupId) qualityQuery.set('classGroupId', classGroupId);

  const matrixQuery = new URLSearchParams({ assessmentId, limit: '1' });
  if (classGroupId) matrixQuery.set('classGroupId', classGroupId);

  const canViewQuality = canAccess(session.user.roles, INSTRUMENT_QUALITY_VIEWER_ROLES);

  const [quality, matrix] = await Promise.all([
    canViewQuality
      ? apiGet<InstrumentQualityResponse>(`/instrument-quality?${qualityQuery.toString()}`).catch(
          () => null,
        )
      : Promise.resolve(null),
    apiGet<ItemMatrixResponse>(`/item-analysis/matrix?${matrixQuery.toString()}`).catch(
      (): ItemMatrixResponse | null => null,
    ),
  ]);

  const questions: MatrixQuestionColumn[] = matrix?.questions ?? [];
  const exportTitle = matrix?.assessmentName ?? matrix?.instrumentName ?? 'evaluacion';

  // Acceso contextual al banco de material remedial de ESTA evaluación (las
  // brechas concretas se generan desde cada tarjeta en `SkillGapsCard`).
  const canViewRemedial = canAccess(session.user.roles, REMEDIAL_VIEWER_ROLES);
  const remedialHref = `/material-remedial?assessmentId=${assessmentId}${
    classGroupId ? `&classGroupId=${classGroupId}` : ''
  }` as Route;

  return (
    <PageContainer>
      {/* Declara el contexto de esta vista para el asistente embebido (E21): al
          abrir el panel, ya sabe sobre qué evaluación/curso se pregunta. */}
      <RegisterAssistantContext
        refs={[
          { kind: 'assessment' as const, id: assessmentId, label: exportTitle },
          ...(classGroupId ? [{ kind: 'classGroup' as const, id: classGroupId }] : []),
        ]}
      />
      <PageHeader
        title="Análisis IA"
        description="Informe pedagógico generado por IA a partir de las métricas de una evaluación: síntesis ejecutiva, ítems destacados y críticos, brechas por habilidad y recomendaciones priorizadas (E20 — H20.2 a H20.7)."
        actions={
          <div className="flex flex-wrap gap-2">
            {canViewRemedial ? (
              <Button asChild variant="outline" size="sm">
                <Link href={remedialHref}>
                  <Lightbulb className="mr-2 size-4" aria-hidden />
                  Material remedial
                </Link>
              </Button>
            ) : null}
            <AskAiButton prompt="Explícame los resultados de esta evaluación: ¿dónde están las mayores brechas y qué priorizar?" />
          </div>
        }
      />
      <AnalysisReport
        output={output}
        analysis={analysis}
        activeRole={activeRole}
        assessmentId={assessmentId}
        classGroupId={classGroupId}
        quality={quality}
        questions={questions}
        exportTitle={exportTitle}
      />
    </PageContainer>
  );
}
