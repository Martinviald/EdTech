import { Module } from '@nestjs/common';
import { ComparableAlertsService } from './comparable-alerts.service';
import { ComparableOverviewService } from './comparable-overview.service';
import { ComparableUnitAssembler } from './comparable/comparable-unit.assembler';
import { DashboardsController } from './dashboards.controller';
import { DashboardsService } from './dashboards.service';

@Module({
  controllers: [DashboardsController],
  providers: [
    DashboardsService,
    ComparableOverviewService,
    ComparableAlertsService,
    ComparableUnitAssembler,
  ],
  exports: [DashboardsService, ComparableOverviewService, ComparableUnitAssembler],
})
export class DashboardsModule {}
