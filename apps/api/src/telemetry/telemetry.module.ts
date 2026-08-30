import { Module } from '@nestjs/common';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';
import { TelemetryUsageService } from './telemetry-usage.service';
import { TelemetryReportService } from './telemetry-report.service';
import { TelemetryWriterService } from './telemetry-writer.service';

@Module({
  controllers: [TelemetryController],
  providers: [
    TelemetryWriterService,
    TelemetryService,
    TelemetryUsageService,
    TelemetryReportService,
  ],
  exports: [TelemetryService],
})
export class TelemetryModule {}
