import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../auth/auth.module';
import { DashboardsModule } from '../dashboards/dashboards.module';
import { HeatmapModule } from '../heatmap/heatmap.module';
import { InstrumentsModule } from '../instruments/instruments.module';
import { ItemAnalysisModule } from '../item-analysis/item-analysis.module';
import { ItemsModule } from '../items/items.module';
import { PerformanceBandsModule } from '../performance-bands/performance-bands.module';
import { TaxonomiesModule } from '../taxonomies/taxonomies.module';
import { McpController } from './adapter/mcp.controller';
import { McpThrottlerGuard } from './adapter/mcp-throttler.guard';
import { McpAuthGuard } from './auth/mcp-auth.guard';
import { McpPrincipalResolver } from './auth/mcp-principal.resolver';
import { ProtectedResourceController } from './auth/protected-resource.controller';
import { AnalyticsToolsFacade } from './core/analytics-tools.facade';
import { McpAuditLogger } from './core/mcp-audit-logger';
import { PromptRegistry } from './core/prompt-registry';
import { ResourceRegistry } from './core/resource-registry';
import { ToolRegistry } from './core/tool-registry';
import { DbMcpAuditLogger } from './observability/db-mcp-audit-logger';
import { AuditarCalidadInstrumentoPrompt } from './prompts/auditar-calidad-instrumento.prompt';
import { ContrastarDificultadPrompt } from './prompts/contrastar-dificultad.prompt';
import { DiagnosticoBrechasCursoPrompt } from './prompts/diagnostico-brechas-curso.prompt';
import { AnalyticsCapabilitiesResource } from './resources/analytics-capabilities.resource';
import { PerformanceBandsResource } from './resources/performance-bands.resource';
import { TaxonomyResource } from './resources/taxonomy.resource';
import { GetAssessmentOverviewTool } from './tools/get-assessment-overview.tool';
import { GetInstrumentBlueprintTool } from './tools/get-instrument-blueprint.tool';
import { GetItemStatisticsTool } from './tools/get-item-statistics.tool';
import { GetSkillGapsTool } from './tools/get-skill-gaps.tool';
import { GetSkillHeatmapTool } from './tools/get-skill-heatmap.tool';
import { ListAssessmentsTool } from './tools/list-assessments.tool';
import { WhoamiTool } from './tools/whoami.tool';

const ANALYTICS_TOOLS = [
  WhoamiTool,
  ListAssessmentsTool,
  GetInstrumentBlueprintTool,
  GetItemStatisticsTool,
  GetSkillGapsTool,
  GetAssessmentOverviewTool,
  GetSkillHeatmapTool,
];

const MCP_PROMPTS = [
  ContrastarDificultadPrompt,
  DiagnosticoBrechasCursoPrompt,
  AuditarCalidadInstrumentoPrompt,
];

const MCP_RESOURCES = [
  TaxonomyResource,
  PerformanceBandsResource,
  AnalyticsCapabilitiesResource,
];

@Module({
  imports: [
    DiscoveryModule,
    AuthModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    InstrumentsModule,
    ItemsModule,
    ItemAnalysisModule,
    DashboardsModule,
    HeatmapModule,
    TaxonomiesModule,
    PerformanceBandsModule,
  ],
  controllers: [McpController, ProtectedResourceController],
  providers: [
    ToolRegistry,
    PromptRegistry,
    ResourceRegistry,
    AnalyticsToolsFacade,
    McpAuthGuard,
    McpThrottlerGuard,
    McpPrincipalResolver,
    { provide: McpAuditLogger, useClass: DbMcpAuditLogger },
    ...ANALYTICS_TOOLS,
    ...MCP_PROMPTS,
    ...MCP_RESOURCES,
  ],
  exports: [AnalyticsToolsFacade, ToolRegistry],
})
export class McpModule {}
