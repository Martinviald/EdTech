import { Module } from '@nestjs/common';
import { ComparableAlertsService } from './comparable-alerts.service';
import { ComparableOverviewService } from './comparable-overview.service';
import { DashboardsController } from './dashboards.controller';
import { DashboardsService } from './dashboards.service';

@Module({
  controllers: [DashboardsController],
  providers: [DashboardsService, ComparableOverviewService, ComparableAlertsService],
  exports: [DashboardsService, ComparableOverviewService],
})
export class DashboardsModule {}
