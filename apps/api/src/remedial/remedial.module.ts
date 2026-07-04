import { Module } from '@nestjs/common';
import { CurriculumRetrieverModule } from '../curriculum-retriever/curriculum-retriever.module';
import { JobsModule } from '../jobs/jobs.module';
import { LlmModule } from '../llm/llm.module';
import { GroupPlanGenerator } from './generators/group-plan.generator';
import { GuideGenerator } from './generators/guide.generator';
import { PracticeGenerator } from './generators/practice.generator';
import { RemedialBriefService } from './remedial-brief.service';
import { RemedialContextService } from './remedial-context.service';
import { RemedialController } from './remedial.controller';
import { REMEDIAL_GENERATORS } from './remedial.generator';
import { RemedialRunner } from './remedial.runner';
import { RemedialService } from './remedial.service';
import { FeatureGuard } from '../common/guards/feature.guard';

/**
 * Módulo de IA Remedial (RAG) — F2 S3 (E9, H9.1–H9.5).
 *
 * Registro + caché + workflow de aprobación (`RemedialService`), ensamblado de
 * contexto curricular RAG (`RemedialContextService` sobre `CURRICULUM_RETRIEVER`),
 * generación async vía `JOB_DISPATCHER` (`RemedialRunner`) y los tres generadores
 * (guía / set de práctica / plan por grupo) resueltos por `type` a través del
 * token `REMEDIAL_GENERATORS`.
 *
 * La integración registra este módulo en `app.module.ts` (no aquí).
 */
@Module({
  imports: [LlmModule, JobsModule, CurriculumRetrieverModule],
  controllers: [RemedialController],
  providers: [
    RemedialService,
    RemedialContextService,
    RemedialBriefService,
    RemedialRunner,
    GuideGenerator,
    PracticeGenerator,
    GroupPlanGenerator,
    {
      provide: REMEDIAL_GENERATORS,
      useFactory: (
        guide: GuideGenerator,
        practice: PracticeGenerator,
        groupPlan: GroupPlanGenerator,
      ) => [guide, practice, groupPlan],
      inject: [GuideGenerator, PracticeGenerator, GroupPlanGenerator],
    },
    FeatureGuard,
  ],
  exports: [RemedialService],
})
export class RemedialModule {}
