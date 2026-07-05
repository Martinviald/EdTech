import { Module } from '@nestjs/common';
import { CurriculumRetrieverModule } from '../curriculum-retriever/curriculum-retriever.module';
import { JobsModule } from '../jobs/jobs.module';
import { LlmModule } from '../llm/llm.module';
import { GroupPlanGenerator } from './generators/group-plan.generator';
import { GuideGenerator } from './generators/guide.generator';
import { PracticeGenerator } from './generators/practice.generator';
import { RemedialBriefService } from './remedial-brief.service';
import { RemedialContextService } from './remedial-context.service';
import { RemedialJudgeService } from './remedial-judge.service';
import { RemedialQualityLoop } from './remedial-quality-loop.service';
import { RemedialController } from './remedial.controller';
import { REMEDIAL_GENERATORS } from './remedial.generator';
import { RemedialRunner } from './remedial.runner';
import { RemedialService } from './remedial.service';
import { BankPassageService } from './stimulus/bank-passage.service';
import { FailedStimulusService } from './stimulus/failed-stimulus.service';
import { GenerateStimulusFallback } from './stimulus/generate-stimulus.fallback';
import { GenerateStimulusProvider } from './stimulus/generate-stimulus.provider';
import { HighestGapPolicy } from './stimulus/highest-gap.policy';
import { PASSAGE_SELECTION_POLICY } from './stimulus/passage-selection.policy';
import {
  FernandezHuertaFormula,
  READABILITY_FORMULA,
} from './stimulus/readability.formula';
import { SelfContainedFallback } from './stimulus/self-contained.fallback';
import { StimulusResolver } from './stimulus/stimulus.resolver';
import { TargetProfiler } from './stimulus/target-profiler';
import { TERMINAL_FALLBACK_POLICY } from './stimulus/terminal-fallback.policy';
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
    // Ola 2.1b: juez automático de calidad + loop de regeneración (solo practice_set).
    RemedialJudgeService,
    RemedialQualityLoop,
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
    // Motor remedial con estímulo (Ola 2.1a): recuperación de pasajes fallados / del
    // banco + resolución del estímulo. Los puertos de política se inyectan por token
    // (patrón `CURRICULUM_RETRIEVER`) para swappearlos sin tocar el resolver (2.2).
    FailedStimulusService,
    BankPassageService,
    StimulusResolver,
    { provide: PASSAGE_SELECTION_POLICY, useClass: HighestGapPolicy },
    // Ola 2.2 (Opción B): generación de un texto nuevo con IA calibrado a la brecha +
    // legibilidad enchufable (Fernández-Huerta). El fallback terminal pasa de
    // `SelfContainedFallback` a `GenerateStimulusFallback` (A sin pasaje → generar = B).
    { provide: READABILITY_FORMULA, useClass: FernandezHuertaFormula },
    TargetProfiler,
    GenerateStimulusProvider,
    GenerateStimulusFallback,
    // `SelfContainedFallback` se conserva registrado para poder revertir el binding de
    // `TERMINAL_FALLBACK_POLICY` a él si se quisiera volver al comportamiento 2.1a.
    SelfContainedFallback,
    { provide: TERMINAL_FALLBACK_POLICY, useClass: GenerateStimulusFallback },
    FeatureGuard,
  ],
  exports: [RemedialService],
})
export class RemedialModule {}
