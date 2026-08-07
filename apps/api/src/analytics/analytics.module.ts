import { Module } from '@nestjs/common';
import { DashboardsModule } from '../dashboards/dashboards.module';
import { AnalyticsController } from './analytics.controller';
import { ComparableTrajectoryService } from './comparable-trajectory.service';

@Module({
  imports: [DashboardsModule],
  controllers: [AnalyticsController],
  providers: [ComparableTrajectoryService],
  exports: [ComparableTrajectoryService],
})
export class AnalyticsModule {}
