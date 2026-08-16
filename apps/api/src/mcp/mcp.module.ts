import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AuthModule } from '../auth/auth.module';
import { McpController } from './adapter/mcp.controller';
import { McpAuthGuard } from './auth/mcp-auth.guard';
import { McpPrincipalResolver } from './auth/mcp-principal.resolver';
import { ProtectedResourceController } from './auth/protected-resource.controller';
import { AnalyticsToolsFacade } from './core/analytics-tools.facade';
import { ToolRegistry } from './core/tool-registry';
import { WhoamiTool } from './tools/whoami.tool';

@Module({
  imports: [DiscoveryModule, AuthModule],
  controllers: [McpController, ProtectedResourceController],
  providers: [
    ToolRegistry,
    AnalyticsToolsFacade,
    McpAuthGuard,
    McpPrincipalResolver,
    WhoamiTool,
  ],
  exports: [AnalyticsToolsFacade, ToolRegistry],
})
export class McpModule {}
