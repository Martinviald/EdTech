import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from '../auth/auth.module';
import { McpController } from './adapter/mcp.controller';
import { McpThrottlerGuard } from './adapter/mcp-throttler.guard';
import { McpAuthGuard } from './auth/mcp-auth.guard';
import { McpPrincipalResolver } from './auth/mcp-principal.resolver';
import { ProtectedResourceController } from './auth/protected-resource.controller';
import { AnalyticsToolsFacade } from './core/analytics-tools.facade';
import { McpAuditLogger } from './core/mcp-audit-logger';
import { ToolRegistry } from './core/tool-registry';
import { DbMcpAuditLogger } from './observability/db-mcp-audit-logger';
import { WhoamiTool } from './tools/whoami.tool';

@Module({
  imports: [
    DiscoveryModule,
    AuthModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
  ],
  controllers: [McpController, ProtectedResourceController],
  providers: [
    ToolRegistry,
    AnalyticsToolsFacade,
    McpAuthGuard,
    McpThrottlerGuard,
    McpPrincipalResolver,
    { provide: McpAuditLogger, useClass: DbMcpAuditLogger },
    WhoamiTool,
  ],
  exports: [AnalyticsToolsFacade, ToolRegistry],
})
export class McpModule {}
