import { Module } from '@nestjs/common';
import { BenchmarkingController } from './benchmarking.controller';
import { BenchmarkingService } from './benchmarking.service';
import { BenchmarkingRefreshService } from './benchmarking-refresh.service';
import { BenchmarkSamplesService } from './benchmark-samples.service';

/**
 * F2 S4 — Benchmarking Institucional (H7.1–H7.4, H7.6).
 *
 * NO se registra en `app.module.ts` aquí — eso lo hace la fase de integración.
 */
@Module({
  controllers: [BenchmarkingController],
  providers: [BenchmarkingService, BenchmarkingRefreshService, BenchmarkSamplesService],
  exports: [BenchmarkingService, BenchmarkingRefreshService, BenchmarkSamplesService],
})
export class BenchmarkingModule {}
