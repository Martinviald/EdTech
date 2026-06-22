import { GetItemContentTool } from './get-item-content.tool';
import type { AssistantToolContext } from './assistant-tool.types';
import type { ItemsService, ItemContentForAssistant } from '../../items/items.service';
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

const ITEM_ID = '11111111-1111-1111-1111-111111111111';
const ASSESSMENT_ID = '22222222-2222-2222-2222-222222222222';

const sampleResult: ItemContentForAssistant = {
  itemId: ITEM_ID,
  position: 3,
  type: 'multiple_choice',
  stem: '¿Cuál es la capital de Chile?',
  alternatives: [
    { key: 'A', text: 'Lima' },
    { key: 'B', text: 'Santiago' },
  ],
  correctKey: 'B',
  skillName: 'Geografía',
};

function makeTool(getContentForAssistant: jest.Mock) {
  const items = { getContentForAssistant } as unknown as ItemsService;
  return new GetItemContentTool(items);
}

const ctx: AssistantToolContext = { user: user() };

describe('GetItemContentTool', () => {
  it('exposes a definition with name get_item_content and required: []', () => {
    const tool = makeTool(jest.fn());
    expect(tool.definition.name).toBe('get_item_content');
    expect(tool.definition.inputSchema).toMatchObject({
      type: 'object',
      required: [],
    });
  });

  it('valid input (itemId) → calls the service with ctx.user and serializes', async () => {
    const spy = jest.fn().mockResolvedValue(sampleResult);
    const tool = makeTool(spy);

    const result = await tool.execute({ itemId: ITEM_ID }, ctx);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(ctx.user, { itemId: ITEM_ID });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content)).toEqual(sampleResult);
  });

  it('valid input (assessmentId + position) → calls the service', async () => {
    const spy = jest.fn().mockResolvedValue(sampleResult);
    const tool = makeTool(spy);

    await tool.execute({ assessmentId: ASSESSMENT_ID, position: 3 }, ctx);

    expect(spy).toHaveBeenCalledWith(ctx.user, {
      assessmentId: ASSESSMENT_ID,
      position: 3,
    });
  });

  it('invalid input → isError without calling the service', async () => {
    const spy = jest.fn();
    const tool = makeTool(spy);

    // Ni itemId ni (assessmentId + position) → el refine falla.
    const result = await tool.execute({ assessmentId: ASSESSMENT_ID }, ctx);

    expect(spy).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content)).toHaveProperty('error');
  });

  it('malformed input (non-uuid) → isError without calling the service', async () => {
    const spy = jest.fn();
    const tool = makeTool(spy);

    const result = await tool.execute({ itemId: 'not-a-uuid' }, ctx);

    expect(spy).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });

  it('service throwing (not found) → isError, no exception escapes', async () => {
    const spy = jest.fn().mockRejectedValue(new Error('Ítem no encontrado'));
    const tool = makeTool(spy);

    const result = await tool.execute({ itemId: ITEM_ID }, ctx);

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content)).toHaveProperty('error');
  });
});
