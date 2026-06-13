import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { CURRICULUM_RETRIEVER } from './curriculum-retriever';
import { StructuredCurriculumRetriever } from './structured-curriculum-retriever';

/**
 * Módulo del puerto CurriculumRetriever (H19.21). Provee la implementación
 * estructurada sobre `taxonomy_nodes` bajo el token `CURRICULUM_RETRIEVER` y la
 * exporta para que los módulos consumidores (motor IA) la inyecten por abstracción.
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: CURRICULUM_RETRIEVER,
      useClass: StructuredCurriculumRetriever,
    },
  ],
  exports: [CURRICULUM_RETRIEVER],
})
export class CurriculumRetrieverModule {}
