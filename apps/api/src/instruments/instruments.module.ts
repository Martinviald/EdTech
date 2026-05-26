import { Module } from '@nestjs/common';
import { InstrumentsController } from './instruments.controller';
import { GradingScalesController } from './grading-scales.controller';
import { InstrumentsService } from './instruments.service';

@Module({
  controllers: [InstrumentsController, GradingScalesController],
  providers: [InstrumentsService],
  exports: [InstrumentsService],
})
export class InstrumentsModule {}
