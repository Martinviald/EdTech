import { Module } from '@nestjs/common';
import { MeasurementProcessesController } from './measurement-processes.controller';
import { MeasurementProcessesService } from './measurement-processes.service';
import { ProcessCoverageService } from './process-coverage.service';

@Module({
  controllers: [MeasurementProcessesController],
  providers: [MeasurementProcessesService, ProcessCoverageService],
  exports: [MeasurementProcessesService],
})
export class MeasurementProcessesModule {}
