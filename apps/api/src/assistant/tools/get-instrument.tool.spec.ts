import { GetInstrumentTool } from './get-instrument.tool';
import type { AssistantToolContext } from './assistant-tool.types';
import type { InstrumentsService } from '../../instruments/instruments.service';
import type { ItemsService } from '../../items/items.service';
import type { JwtPayload } from '../../auth/jwt-payload.types';

function user(overrides: Partial<JwtPayload> = {}): JwtPayload {
  const role = overrides.activeRole ?? overrides.role ?? 'school_admin';
  return {
    userId: 'u1',
    orgId: 'org-1',
    email: 'a@b.cl',
    name: 'Test',
    roles: [role],
    activeRole: role,
    role,
    isPlatformAdmin: role === 'platform_admin',
    ...overrides,
  };
}

const INSTRUMENT_ID = '11111111-1111-1111-1111-111111111111';

function makeTool(getById: jest.Mock, list: jest.Mock) {
  const instruments = { getById } as unknown as InstrumentsService;
  const items = { list } as unknown as ItemsService;
  return new GetInstrumentTool(instruments, items);
}

const ctx: AssistantToolContext = { user: user() };

const sampleInstrument = {
  id: INSTRUMENT_ID,
  name: 'DIA Matemática 3° Básico',
  shortName: 'DIA Mat',
  type: 'dia',
  subjectId: 'subj-1',
  gradeId: 'grade-1',
  year: 2025,
  status: 'published',
  isOfficial: true,
  // Campos que NO deben filtrarse al payload del asistente:
  config: { secret: 'x' },
  sections: [
    { id: 'sec-1', name: 'Números', type: 'closed', order: 1, maxPoints: 10, config: { foo: 1 } },
  ],
};

const sampleItemsPage = {
  data: [
    {
      id: 'item-1',
      position: 1,
      type: 'multiple_choice',
      content: { stem: '¿Cuánto es 2+2?', alternatives: [{ key: 'A', text: '3' }] },
    },
  ],
  total: 1,
  page: 1,
  limit: 100,
};

describe('GetInstrumentTool', () => {
  it('exposes a definition with name get_instrument and required instrumentId', () => {
    const tool = makeTool(jest.fn(), jest.fn());
    expect(tool.definition.name).toBe('get_instrument');
    expect(tool.definition.inputSchema).toMatchObject({
      type: 'object',
      required: ['instrumentId'],
    });
  });

  it('valid input → compone instrumento + secciones + ítems con la identidad del JWT', async () => {
    const getById = jest.fn().mockResolvedValue(sampleInstrument);
    const list = jest.fn().mockResolvedValue(sampleItemsPage);
    const tool = makeTool(getById, list);

    const result = await tool.execute({ instrumentId: INSTRUMENT_ID }, ctx);

    expect(getById).toHaveBeenCalledWith(INSTRUMENT_ID, ctx.user);
    expect(list).toHaveBeenCalledWith(ctx.user, {
      instrumentId: INSTRUMENT_ID,
      scope: 'all',
      page: 1,
      pageSize: 100,
    });
    expect(result.isError).toBeUndefined();

    const payload = JSON.parse(result.content);
    expect(payload.instrument).toMatchObject({ id: INSTRUMENT_ID, name: 'DIA Matemática 3° Básico' });
    expect(payload.sections).toEqual([
      { id: 'sec-1', name: 'Números', type: 'closed', order: 1, maxPoints: 10 },
    ]);
    expect(payload.items).toEqual([
      { id: 'item-1', position: 1, type: 'multiple_choice', stem: '¿Cuánto es 2+2?' },
    ]);
    expect(payload.itemCount).toBe(1);
  });

  it('no filtra contenido pesado del ítem ni config interna', async () => {
    const getById = jest.fn().mockResolvedValue(sampleInstrument);
    const list = jest.fn().mockResolvedValue(sampleItemsPage);
    const tool = makeTool(getById, list);

    const result = await tool.execute({ instrumentId: INSTRUMENT_ID }, ctx);

    // Las alternativas (contenido pesado) y la config interna NO viajan al modelo.
    expect(result.content).not.toContain('alternatives');
    expect(result.content).not.toContain('secret');
  });

  it('trunca el enunciado largo a un preview corto', async () => {
    const longStem = 'a'.repeat(300);
    const getById = jest.fn().mockResolvedValue({ ...sampleInstrument, sections: [] });
    const list = jest.fn().mockResolvedValue({
      ...sampleItemsPage,
      data: [{ id: 'item-2', position: 2, type: 'open_ended', content: { stem: longStem } }],
    });
    const tool = makeTool(getById, list);

    const result = await tool.execute({ instrumentId: INSTRUMENT_ID }, ctx);
    const payload = JSON.parse(result.content);

    expect(payload.items[0].stem.length).toBeLessThan(longStem.length);
    expect(payload.items[0].stem.endsWith('…')).toBe(true);
  });

  it('malformed input (non-uuid) → isError without calling the services', async () => {
    const getById = jest.fn();
    const list = jest.fn();
    const tool = makeTool(getById, list);

    const result = await tool.execute({ instrumentId: 'not-a-uuid' }, ctx);

    expect(getById).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content)).toHaveProperty('error');
  });

  it('service throwing (not found / sin acceso) → isError, no exception escapes', async () => {
    const getById = jest.fn().mockRejectedValue(new Error('Instrumento no encontrado'));
    const tool = makeTool(getById, jest.fn());

    const result = await tool.execute({ instrumentId: INSTRUMENT_ID }, ctx);

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content)).toHaveProperty('error');
  });
});
