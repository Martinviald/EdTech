import { Module } from '@nestjs/common';
import { MeasurementProcessesController } from './measurement-processes.controller';
import { MeasurementProcessesService } from './measurement-processes.service';

@Module({
  controllers: [MeasurementProcessesController],
  providers: [MeasurementProcessesService],
  exports: [MeasurementProcessesService],
})
export class MeasurementProcessesModule {}
