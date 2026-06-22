import { redirect } from 'next/navigation';
import { Sparkles, ClipboardList } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  AI_ANALYSIS_VIEWER_ROLES,
  INSTRUMENT_QUALITY_VIEWER_ROLES,
  assessmentInsightsOutputSchema,
  type AiAnalysisModel,
  type AssessmentInsightsOutput,
  type InstrumentQualityResponse,
  type ItemMatrixResponse,
  type MatrixQuestionColumn,
} from '@soe/types';
import { PageContainer, PageHeader, EmptyState } from '@/components/patterns';
import { FeatureUpgradeNotice } from '@/components/feature-gate';
import { RegisterAssistantContext } from '@/components/assistant';
import { isFeatureEnabled } from '@/lib/features';
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

  // Sin evaluación seleccionada: el análisis se genera para una evaluación
  // específica. Normalmente se llega aquí desde el Informe de Evaluación.
  if (!assessmentId) {
    return (
      <PageContainer>
        {header}
        <EmptyState
          icon={ClipboardList}
          title="Selecciona una evaluación"
          description="El análisis IA se genera para una evaluación específica. Accede desde el Informe de evaluación para elegir una evaluación con resultados."
        />
      </PageContainer>
    );
  }

  // Sin análisis aún: ofrecer generarlo.
  if (!analysisId) {
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
              audience={activeRole === 'teacher' ? 'teacher' : 'director'}
            />
          }
        />
      </PageContainer>
    );
  }

  // Hay un análisis: consultar su estado.
  let analysis: AiAnalysisModel | null = null;
  let loadError = false;
  try {
    analysis = await apiGet<AiAnalysisModel>(`/ai-analysis/${analysisId}`);
  } catch {
    loadError = true;
  }

  if (loadError || !analysis) {
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
              audience={activeRole === 'teacher' ? 'teacher' : 'director'}
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
              audience={activeRole === 'teacher' ? 'teacher' : 'director'}
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
              audience={activeRole === 'teacher' ? 'teacher' : 'director'}
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
      {header}
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
