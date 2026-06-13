import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
// JobsModule (H19.20, Agente A) provee el puerto JOB_DISPATCHER. Si aún no
// existe al compilar (otro agente lo crea), la integración (Fase 4) conecta la
// impl; este módulo declara la dependencia por el puerto.
import { JobsModule } from '../jobs/jobs.module';
import { AiAnalysisController } from './ai-analysis.controller';
import { AiAnalysisService } from './ai-analysis.service';
import { AiAnalysisRunner } from './ai-analysis.runner';

/**
 * Motor IA base (H19.23): registro + caché de análisis sobre `LlmService`
 * existente, con ejecución async vía el puerto `JOB_DISPATCHER`.
 */
@Module({
  imports: [LlmModule, JobsModule],
  controllers: [AiAnalysisController],
  providers: [AiAnalysisService, AiAnalysisRunner],
  exports: [AiAnalysisService],
})
export class AiAnalysisModule {}
