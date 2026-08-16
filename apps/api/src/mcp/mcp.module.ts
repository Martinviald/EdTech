import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../auth/auth.module';
import { DashboardsModule } from '../dashboards/dashboards.module';
import { HeatmapModule } from '../heatmap/heatmap.module';
import { InstrumentsModule } from '../instruments/instruments.module';
import { ItemAnalysisModule } from '../item-analysis/item-analysis.module';
import { ItemsModule } from '../items/items.module';
import { McpController } from './adapter/mcp.controller';
import { McpThrottlerGuard } from './adapter/mcp-throttler.guard';
import { McpAuthGuard } from './auth/mcp-auth.guard';
import { McpPrincipalResolver } from './auth/mcp-principal.resolver';
import { ProtectedResourceController } from './auth/protected-resource.controller';
import { AnalyticsToolsFacade } from './core/analytics-tools.facade';
import { McpAuditLogger } from './core/mcp-audit-logger';
import { ToolRegistry } from './core/tool-registry';
import { DbMcpAuditLogger } from './observability/db-mcp-audit-logger';
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
  ],
  controllers: [McpController, ProtectedResourceController],
  providers: [
    ToolRegistry,
    AnalyticsToolsFacade,
    McpAuthGuard,
    McpThrottlerGuard,
    McpPrincipalResolver,
    { provide: McpAuditLogger, useClass: DbMcpAuditLogger },
    ...ANALYTICS_TOOLS,
  ],
  exports: [AnalyticsToolsFacade, ToolRegistry],
})
export class McpModule {}
