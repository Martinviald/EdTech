import type { InstrumentsService } from '../../instruments/instruments.service';
import type { ItemsService } from '../../items/items.service';
import { GetInstrumentBlueprintTool } from './get-instrument-blueprint.tool';
import { makePrincipal } from '../testing/make-principal';

const INSTRUMENT_ID = '11111111-1111-4111-8111-111111111111';

function makeTool(instrument: unknown, itemsPage: unknown) {
  const instruments = {
    getById: jest.fn().mockResolvedValue(instrument),
  } as unknown as InstrumentsService;
  const items = {
    list: jest.fn().mockResolvedValue(itemsPage),
  } as unknown as ItemsService;
  return { tool: new GetInstrumentBlueprintTool(instruments, items), instruments, items };
}

describe('GetInstrumentBlueprintTool', () => {
  it('combina instrumento + secciones + ítems y expone dificultad declarada, IRT y habilidades', async () => {
    const { tool, instruments, items } = makeTool(
      {
        id: INSTRUMENT_ID,
        name: 'DIA Lectura 3° 2025',
        type: 'dia',
        subjectId: 'subj-1',
        gradeId: 'grade-1',
        year: 2025,
        status: 'published',
        isOfficial: true,
        sections: [{ id: 'sec-1', name: 'Sección 1', type: 'multiple_choice', order: 1, maxPoints: '10' }],
        enunciadoPdf: null,
      },
      {
        data: [
          {
            id: 'item-1',
            position: 1,
            sectionId: 'sec-1',
            type: 'multiple_choice',
            difficulty: 'hard',
            irtParams: { a: 1.2, b: 1.8, c: 0.2 },
            scoringConfig: { points: 1 },
            status: 'published',
            tags: [
              { nodeId: 'node-1', tagType: 'primary', node: { name: 'Interpretar', code: 'OA-1' } },
            ],
          },
        ],
        total: 1,
        page: 1,
        limit: 100,
      },
    );

    const result = (await tool.execute(makePrincipal(), { instrumentId: INSTRUMENT_ID })) as {
      instrument: { id: string; isOfficial: boolean };
      items: Array<{ declaredDifficulty: string; irtParams: unknown; skills: unknown[] }>;
      itemsTruncated: boolean;
    };

    expect(instruments.getById).toHaveBeenCalledWith(INSTRUMENT_ID, expect.anything());
    expect(items.list).toHaveBeenCalled();
    expect(result.instrument.id).toBe(INSTRUMENT_ID);
    expect(result.items[0]).toMatchObject({
      declaredDifficulty: 'hard',
      irtParams: { a: 1.2, b: 1.8, c: 0.2 },
      skills: [{ nodeId: 'node-1', name: 'Interpretar', code: 'OA-1', tagType: 'primary' }],
    });
    expect(result.itemsTruncated).toBe(false);
  });

  it('marca itemsTruncated cuando hay más ítems que la página', async () => {
    const { tool } = makeTool(
      { id: INSTRUMENT_ID, name: 'x', type: 'dia', sections: [], enunciadoPdf: null },
      { data: [], total: 150, page: 1, limit: 100 },
    );

    const result = (await tool.execute(makePrincipal(), { instrumentId: INSTRUMENT_ID })) as {
      itemsTruncated: boolean;
    };

    expect(result.itemsTruncated).toBe(true);
  });
});
