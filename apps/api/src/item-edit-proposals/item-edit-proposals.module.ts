import { Module } from '@nestjs/common';
import { ItemsModule } from '../items/items.module';
import { LlmModule } from '../llm/llm.module';
import { ItemEditProposalsController } from './item-edit-proposals.controller';
import { ItemEditProposalsService } from './item-edit-proposals.service';

/**
 * Módulo de propuestas de edición de ítems (TKT-19 — escritura asistida por IA).
 *
 * Da al asistente (y a la UI del banco) la capacidad de PROPONER ediciones de
 * ítems bajo el principio §8.3 (la IA propone, el humano aprueba). Reusa
 * `ItemsService` (cargar/aplicar el cambio al ítem, versionado) y `LlmService`
 * (redactar la propuesta). Exporta su service para que la tool `propose_item_edit`
 * del AssistantModule lo inyecte. `DatabaseModule` es `@Global`.
 */
@Module({
  imports: [ItemsModule, LlmModule],
  controllers: [ItemEditProposalsController],
  providers: [ItemEditProposalsService],
  exports: [ItemEditProposalsService],
})
export class ItemEditProposalsModule {}
