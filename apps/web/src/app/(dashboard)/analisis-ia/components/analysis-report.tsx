import { Sparkles } from 'lucide-react';
import type {
  AiAnalysisModel,
  AssessmentInsightsOutput,
  UserRole,
} from '@soe/types';
import { AlertCallout } from '@/components/patterns';
import { Badge } from '@/components/ui/badge';
import { ExecutiveSummary } from './executive-summary';
import { TopItemsCard, BottomItemsCard } from './item-cards';
import { SkillGapsCard } from './skill-gaps';
import { RecommendationsCard } from './recommendations';
import { ReliabilityPanel } from './reliability-panel';
import { ReportActions } from './report-actions';

interface AnalysisReportProps {
  output: AssessmentInsightsOutput;
  analysis: AiAnalysisModel;
  activeRole: UserRole;
  assessmentId: string;
  classGroupId?: string;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/**
 * Render completo del informe IA (completed). Vista adaptativa por `activeRole`
 * en la síntesis ejecutiva y en la priorización de recomendaciones.
 */
export function AnalysisReport({
  output,
  analysis,
  activeRole,
  assessmentId,
  classGroupId,
}: AnalysisReportProps) {
  const generatedAt = formatDate(analysis.completedAt ?? analysis.createdAt);

  return (
    <div className="space-y-6">
      {/* Encabezado del informe + acciones */}
      <div className="flex flex-col gap-4 rounded-lg border bg-card p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-primary" aria-hidden />
            <Badge variant="secondary">Generado por IA</Badge>
            {analysis.model ? <Badge variant="outline">{analysis.model}</Badge> : null}
          </div>
          <h2 className="text-lg font-semibold text-foreground">{output.headline}</h2>
          {generatedAt ? (
            <p className="text-xs text-muted-foreground">Generado el {generatedAt}</p>
          ) : null}
        </div>
        <ReportActions
          assessmentId={assessmentId}
          classGroupId={classGroupId}
          activeRole={activeRole}
        />
      </div>

      {/* Disclaimer visible (H20.7) */}
      <AlertCallout
        tone="warning"
        title="Sugerencia generada por IA — validar antes de actuar"
      >
        Este informe interpreta métricas deterministas de la evaluación. Revisa y valida
        cada conclusión con tu criterio pedagógico antes de tomar decisiones.
      </AlertCallout>

      <ExecutiveSummary
        director={output.executiveSummary.director}
        teacher={output.executiveSummary.teacher}
        activeRole={activeRole}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <TopItemsCard items={output.topItems} />
        <BottomItemsCard items={output.bottomItems} />
      </div>

      <SkillGapsCard skillGaps={output.skillGaps} />

      <RecommendationsCard
        recommendations={output.recommendations}
        activeRole={activeRole}
      />

      <ReliabilityPanel
        reliability={output.reliability}
        confidence={output.confidence}
        caveats={output.caveats}
      />
    </div>
  );
}
