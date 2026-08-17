import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ITEM_VIEWER_ROLES } from '@soe/types';
import { InstrumentsService } from '../../instruments/instruments.service';
import { ItemsService } from '../../items/items.service';
import { listItemsQuerySchema } from '../../items/dto/item.dto';
import type { AnalyticsPrincipal } from '../core/analytics-principal';
import { AnalyticsTool, type ToolDescriptor } from '../core/analytics-tool';

const inputSchema = z.object({
  instrumentId: z.string().uuid(),
});

type Input = z.infer<typeof inputSchema>;

const BLUEPRINT_ITEM_PAGE_SIZE = 100;

interface RawTag {
  nodeId: string;
  tagType: string;
  node?: { name?: string | null; code?: string | null } | null;
}

@AnalyticsTool()
@Injectable()
export class GetInstrumentBlueprintTool implements AnalyticsTool<Input, unknown> {
  readonly descriptor: ToolDescriptor = {
    name: 'get_instrument_blueprint',
    description:
      'Estructura de un instrumento: secciones e ítems con su dificultad DECLARADA ' +
      '(campo difficulty y parámetros IRT), puntaje y las habilidades de taxonomía que mide cada ' +
      'ítem. Es la base para contrastar la dificultad declarada contra la empírica que devuelve ' +
      'get_item_statistics.',
    inputSchema,
    requiredRoles: ITEM_VIEWER_ROLES,
    piiLevel: 'aggregate',
  };

  constructor(
    private readonly instruments: InstrumentsService,
    private readonly items: ItemsService,
  ) {}

  async execute(principal: AnalyticsPrincipal, input: Input): Promise<unknown> {
    const instrument = await this.instruments.getById(input.instrumentId, principal);
    const itemsPage = await this.items.list(
      principal,
      listItemsQuerySchema.parse({
        instrumentId: input.instrumentId,
        pageSize: BLUEPRINT_ITEM_PAGE_SIZE,
      }),
    );

    return {
      instrument: {
        id: instrument.id,
        name: instrument.name,
        type: instrument.type,
        subjectId: instrument.subjectId,
        gradeId: instrument.gradeId,
        year: instrument.year,
        status: instrument.status,
        isOfficial: instrument.isOfficial,
      },
      sections: instrument.sections.map((section) => ({
        id: section.id,
        name: section.name,
        type: section.type,
        order: section.order,
        maxPoints: section.maxPoints,
      })),
      items: itemsPage.data.map((item) => ({
        id: item.id,
        position: item.position,
        sectionId: item.sectionId,
        type: item.type,
        declaredDifficulty: item.difficulty,
        irtParams: item.irtParams,
        scoringConfig: item.scoringConfig,
        status: item.status,
        skills: (item.tags as RawTag[]).map((tag) => ({
          nodeId: tag.nodeId,
          name: tag.node?.name ?? null,
          code: tag.node?.code ?? null,
          tagType: tag.tagType,
        })),
      })),
      itemCount: itemsPage.total,
      itemsTruncated: itemsPage.total > itemsPage.data.length,
    };
  }
}
