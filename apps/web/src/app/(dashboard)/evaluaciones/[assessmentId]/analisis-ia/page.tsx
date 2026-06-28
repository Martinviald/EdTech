import { redirect } from 'next/navigation';
import { Sparkles } from 'lucide-react';
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
import { EmptyState } from '@/components/patterns';
import { FeatureUpgradeNotice } from '@/components/feature-gate';
import { isFeatureEnabled } from '@/lib/features';
import { GenerateButton } from '../../../analisis-ia/components/generate-button';
import { AnalysisPoller } from '../../../analisis-ia/components/analysis-poller';
import { AnalysisReport } from '../../../analisis-ia/components/analysis-report';

export const dynamic = 'force-dynamic';

function pickParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : undefined;
}

export default async function EvaluacionAnalisisIaPage({
  params,
  searchParams,
}: {
  params: Promise<{ assessmentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, AI_ANALYSIS_VIEWER_ROLES)) redirect('/dashboard');
  if (!(await isFeatureEnabled('ai_analysis'))) {
    return <FeatureUpgradeNotice feature="ai_analysis" />;
  }

  const activeRole = session.user.activeRole;
  const { assessmentId } = await params;
  const sp = await searchParams;
  const analysisId = pickParam(sp.analysisId);
  const classGroupId = pickParam(sp.classGroupId);
  const basePath = `/evaluaciones/${assessmentId}/analisis-ia`;
  const audience = activeRole === 'teacher' ? 'teacher' : 'director';

  // Resolver el análisis: por `analysisId` explícito (recién generado / polling) o,
  // si no viene (al abrir la pestaña), buscando el ÚLTIMO ya existente para esta
  // evaluación + audiencia + curso. Evita ofrecer "generar" cuando ya hay informe.
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
      <div className="space-y-6">
        <EmptyState
          icon={Sparkles}
          title="No se pudo cargar el análisis"
          description="No tienes acceso a este análisis o no existe. Puedes generar uno nuevo."
          action={
            <GenerateButton
              assessmentId={assessmentId}
              classGroupId={classGroupId}
              audience={audience}
              basePath={basePath}
            />
          }
        />
      </div>
    );
  }

  // No hay ningún análisis para esta evaluación todavía → ofrecer generarlo.
  if (!analysis) {
    return (
      <div className="space-y-6">
        <EmptyState
          icon={Sparkles}
          title="Aún no hay análisis para esta evaluación"
          description="Genera un informe IA que interpreta las métricas de la evaluación y propone acciones concretas. El proceso es asíncrono y puede tomar algunos segundos."
          action={
            <GenerateButton
              assessmentId={assessmentId}
              classGroupId={classGroupId}
              audience={audience}
              basePath={basePath}
            />
          }
        />
      </div>
    );
  }

  // En curso: el cliente reconsulta GET /:id hasta completed/failed.
  if (analysis.status === 'pending' || analysis.status === 'processing') {
    return (
      <div className="space-y-6">
        <AnalysisPoller analysisId={analysis.id} status={analysis.status} />
      </div>
    );
  }

  if (analysis.status === 'failed') {
    return (
      <div className="space-y-6">
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
              basePath={basePath}
              force
              label="Reintentar"
            />
          }
        />
      </div>
    );
  }

  // completed → validar/parsear el output con el schema compartido.
  const parsed = assessmentInsightsOutputSchema.safeParse(analysis.output);
  if (!parsed.success) {
    return (
      <div className="space-y-6">
        <EmptyState
          icon={Sparkles}
          title="El análisis tiene un formato inesperado"
          description="La salida del análisis no pudo validarse. Genera uno nuevo para reintentar."
          action={
            <GenerateButton
              assessmentId={assessmentId}
              classGroupId={classGroupId}
              audience={audience}
              basePath={basePath}
              force
              label="Regenerar"
            />
          }
        />
      </div>
    );
  }

  const output: AssessmentInsightsOutput = parsed.data;

  // Datos deterministas complementarios (calidad + columnas de ítems). Best-effort.
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
    <div className="space-y-6">
      <AnalysisReport
        output={output}
        analysis={analysis}
        activeRole={activeRole}
        assessmentId={assessmentId}
        classGroupId={classGroupId}
        quality={quality}
        questions={questions}
        exportTitle={exportTitle}
        basePath={basePath}
      />
    </div>
  );
}
