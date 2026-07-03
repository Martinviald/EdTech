import { Module } from '@nestjs/common';
import { BenchmarkSettingsController } from './benchmark-settings.controller';
import { BenchmarkSettingsService } from './benchmark-settings.service';

@Module({
  controllers: [BenchmarkSettingsController],
  providers: [BenchmarkSettingsService],
  exports: [BenchmarkSettingsService],
})
export class BenchmarkSettingsModule {}
