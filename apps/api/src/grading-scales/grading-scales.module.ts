import { Module } from '@nestjs/common';
import { GradingScalesController } from './grading-scales.controller';
import { GradingScalesService } from './grading-scales.service';

@Module({
  controllers: [GradingScalesController],
  providers: [GradingScalesService],
  exports: [GradingScalesService],
})
export class GradingScalesModule {}
