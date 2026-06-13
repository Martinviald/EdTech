import { Module } from '@nestjs/common';
import { JOB_DISPATCHER } from './job-dispatcher';
import { InProcessJobDispatcher } from './in-process-job-dispatcher';

/**
 * Módulo de despacho de jobs asíncronos (H19.20 · F2 S0).
 *
 * Provee y exporta el puerto `JOB_DISPATCHER` bindeado a la implementación
 * in-process. Los módulos de dominio (p.ej. `ai-analysis`) inyectan el token y
 * encolan jobs sin conocer la implementación concreta.
 */
@Module({
  providers: [{ provide: JOB_DISPATCHER, useClass: InProcessJobDispatcher }],
  exports: [JOB_DISPATCHER],
})
export class JobsModule {}
