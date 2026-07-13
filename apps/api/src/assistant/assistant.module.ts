import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AssessmentReportModule } from '../assessment-report/assessment-report.module';
import { AssessmentResultsModule } from '../assessment-results/assessment-results.module';
import { DashboardsModule } from '../dashboards/dashboards.module';
import { HeatmapModule } from '../heatmap/heatmap.module';
import { InstrumentsModule } from '../instruments/instruments.module';
import { ItemAnalysisModule } from '../item-analysis/item-analysis.module';
import { ItemsModule } from '../items/items.module';
import { ItemEditProposalsModule } from '../item-edit-proposals/item-edit-proposals.module';
import { LlmModule } from '../llm/llm.module';
import { ASSISTANT_TOOLS } from './assistant.constants';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import type { AssistantTool } from './tools/assistant-tool.types';
import { GetAssessmentReportTool } from './tools/get-assessment-report.tool';
import { GetDashboardOverviewTool } from './tools/get-dashboard-overview.tool';
import { GetDashboardPerformanceTool } from './tools/get-dashboard-performance.tool';
import { GetDashboardSkillsTool } from './tools/get-dashboard-skills.tool';
import { GetGenerationalTool } from './tools/get-generational.tool';
import { GetHeatmapTool } from './tools/get-heatmap.tool';
import { GetInstrumentTool } from './tools/get-instrument.tool';
import { GetItemContentTool } from './tools/get-item-content.tool';
import { GetProgressionTool } from './tools/get-progression.tool';
import { GetStudentDetailTool } from './tools/get-student-detail.tool';
import { ListAssessmentsTool } from './tools/list-assessments.tool';
import { ListFilterOptionsTool } from './tools/list-filter-options.tool';
import { ProposeItemEditTool } from './tools/propose-item-edit.tool';

/**
 * Módulo del Asistente IA Conversacional (E21 — Ola 3).
 *
 * Registra las tools read-only (una clase `@Injectable()` por tool) y las
 * agrupa en el token `ASSISTANT_TOOLS` vía una factory — mismo patrón que
 * `LLM_PROVIDERS` en `LlmModule`. El `AssistantService` recibe esa lista y
 * construye el `executeTool` del loop agéntico. Cada tool inyecta el service de
 * dominio que envuelve; por eso se importan los módulos de dominio (que ya
 * exportan sus services). `DatabaseModule` es `@Global` → no se importa aquí.
 */
const ASSISTANT_TOOL_CLASSES = [
  ListFilterOptionsTool,
  ListAssessmentsTool,
  GetDashboardOverviewTool,
  GetDashboardSkillsTool,
  GetDashboardPerformanceTool,
  GetHeatmapTool,
  GetProgressionTool,
  GetGenerationalTool,
  GetAssessmentReportTool,
  GetStudentDetailTool,
  GetItemContentTool,
  GetInstrumentTool,
  ProposeItemEditTool,
] as const;

@Module({
  imports: [
    LlmModule,
    DashboardsModule,
    HeatmapModule,
    AnalyticsModule,
    AssessmentReportModule,
    AssessmentResultsModule,
    InstrumentsModule,
    ItemsModule,
    ItemEditProposalsModule,
    ItemAnalysisModule,
  ],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    ...ASSISTANT_TOOL_CLASSES,
    {
      provide: ASSISTANT_TOOLS,
      useFactory: (...tools: AssistantTool[]): AssistantTool[] => tools,
      inject: [...ASSISTANT_TOOL_CLASSES],
    },
  ],
})
export class AssistantModule {}
