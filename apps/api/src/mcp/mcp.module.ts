import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AnalyticsToolsFacade } from './core/analytics-tools.facade';
import { ToolRegistry } from './core/tool-registry';
import { WhoamiTool } from './tools/whoami.tool';

@Module({
  imports: [DiscoveryModule],
  providers: [ToolRegistry, AnalyticsToolsFacade, WhoamiTool],
  exports: [AnalyticsToolsFacade, ToolRegistry],
})
export class McpModule {}
