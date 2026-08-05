import { Module } from '@nestjs/common';
import { ComparableOverviewService } from './comparable-overview.service';
import { DashboardsController } from './dashboards.controller';
import { DashboardsService } from './dashboards.service';

@Module({
  controllers: [DashboardsController],
  providers: [DashboardsService, ComparableOverviewService],
  exports: [DashboardsService, ComparableOverviewService],
})
export class DashboardsModule {}
