import { Module } from '@nestjs/common';
import { AiObservabilityController } from './ai-observability.controller';
import { AiObservabilityService } from './ai-observability.service';

/**
 * H19.25 — Observabilidad de costo/latencia IA.
 *
 * NO se registra en `app.module.ts` aquí — eso lo hace la fase de integración.
 */
@Module({
  controllers: [AiObservabilityController],
  providers: [AiObservabilityService],
  exports: [AiObservabilityService],
})
export class AiObservabilityModule {}
