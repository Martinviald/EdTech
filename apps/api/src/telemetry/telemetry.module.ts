import { Module } from '@nestjs/common';
import { TelemetryController } from './telemetry.controller';
import { TelemetryService } from './telemetry.service';
import { TelemetryUsageService } from './telemetry-usage.service';
import { TelemetryWriterService } from './telemetry-writer.service';

@Module({
  controllers: [TelemetryController],
  providers: [TelemetryWriterService, TelemetryService, TelemetryUsageService],
  exports: [TelemetryService],
})
export class TelemetryModule {}
