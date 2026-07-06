import { Module } from '@nestjs/common';
import { PerformanceBandsController } from './performance-bands.controller';
import { PerformanceBandsService } from './performance-bands.service';

@Module({
  controllers: [PerformanceBandsController],
  providers: [PerformanceBandsService],
  exports: [PerformanceBandsService],
})
export class PerformanceBandsModule {}
