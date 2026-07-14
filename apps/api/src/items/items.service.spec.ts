import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ItemsService } from './items.service';
import type { JwtPayload } from '../auth/jwt-payload.types';
import type { Item } from '@soe/db';
import type { ItemType } from '@soe/types';
import type { CreateItemDto, UpdateItemDto } from './dto/item.dto';

function makeService() {
  const db = {} as never;
  return new ItemsService(db);
}

function user(overrides: Partial<JwtPayload> = {}): JwtPayload {
  const role = overrides.activeRole ?? overrides.role ?? 'school_admin';
  const isPlatformAdmin = overrides.isPlatformAdmin ?? (role === 'platform_admin');
  return {
    userId: 'u1',
    orgId: 'org-1',
    email: 'a@b.cl',
    name: 'Test',
    roles: [role],
    activeRole: role,
    role,
    ...overrides,
    isPlatformAdmin,
  };
}

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: 'item-1',
    orgId: 'org-1',
    instrumentId: null,
    sectionId: null,
    position: 0,
    type: 'multiple_choice',
    content: {},
    scoringConfig: { points: 1 },
    irtParams: {},
    status: 'draft',
    version: 1,
    source: 'custom',
    createdById: 'u1',
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Item;
}

describe('ItemsService.assertVisible', () => {
  const svc = makeService();

  it('allows viewing official items (null orgId) for any user', () => {
    expect(() =>
      svc.assertVisible(item({ orgId: null }), user()),
    ).not.toThrow();
  });

  it('allows viewing items from own org', () => {
    expect(() =>
      svc.assertVisible(item({ orgId: 'org-1' }), user({ orgId: 'org-1' })),
    ).not.toThrow();
  });

  it('blocks items from another org', () => {
    expect(() =>
      svc.assertVisible(item({ orgId: 'other' }), user({ orgId: 'org-1' })),
    ).toThrow(ForbiddenException);
  });

  it('platform_admin can see anything', () => {
    expect(() =>
      svc.assertVisible(
        item({ orgId: 'other' }),
        user({ role: 'platform_admin' }),
      ),
    ).not.toThrow();
  });
});

describe('ItemsService.assertEditable', () => {
  const svc = makeService();

  it('blocks official items (null orgId) for non-admin', () => {
    expect(() =>
      svc.assertEditable(item({ orgId: null }), user({ role: 'school_admin' })),
    ).toThrow(ForbiddenException);
  });

  it('allows platform_admin to edit official items', () => {
    expect(() =>
      svc.assertEditable(item({ orgId: null }), user({ role: 'platform_admin' })),
    ).not.toThrow();
  });

  it('allows editing items from own org', () => {
    expect(() =>
      svc.assertEditable(
        item({ orgId: 'org-1' }),
        user({ orgId: 'org-1', role: 'school_admin' }),
      ),
    ).not.toThrow();
  });

  it('blocks editing items from another org', () => {
    expect(() =>
      svc.assertEditable(
        item({ orgId: 'other' }),
        user({ orgId: 'org-1', role: 'school_admin' }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('platform_admin can edit items from any org', () => {
    expect(() =>
      svc.assertEditable(
        item({ orgId: 'other' }),
        user({ role: 'platform_admin' }),
      ),
    ).not.toThrow();
  });
});

// ── Polymorphic content validation (#5) ────────────────────────────────────
//
// `create`/`update` validan el `content` contra el schema Zod de su `type`
// (validateItemContent de @soe/types) ANTES de persistir. Un content inválido
// para su tipo => BadRequestException; uno válido => no se rechaza.

/**
 * Content de ejemplo VÁLIDO por cada uno de los 10 item_type.
 * Tipado como `Item['content']` (la unión `ItemContent`) vía cast para poder
 * pasarlo a `item({ content })` sin fricción de assignability de la unión; las
 * formas reales se validan en runtime por `validateItemContent`.
 */
const VALID_CONTENT = {
  multiple_choice: {
    stem: '¿2 + 2?',
    alternatives: [
      { key: 'A', text: '3', isCorrect: false },
      { key: 'B', text: '4', isCorrect: true },
    ],
  },
  true_false: { stem: 'El cielo es azul', correctAnswer: true },
  open_ended: { prompt: 'Explica el ciclo del agua' },
  writing: { prompt: 'Escribe un cuento breve', minWords: 50 },
  oral_reading: { passage: 'Había una vez un gato...' },
  oral_expression: { prompt: 'Describe tu rutina diaria' },
  listening: {
    audioUrl: 'https://cdn.example.com/audio.mp3',
    stem: '¿Qué animal se menciona?',
    alternatives: [
      { key: 'A', text: 'Perro', isCorrect: true },
      { key: 'B', text: 'Gato', isCorrect: false },
    ],
  },
  matching: {
    leftItems: [
      { id: 'l1', text: 'Chile' },
      { id: 'l2', text: 'Perú' },
    ],
    rightItems: [
      { id: 'r1', text: 'Santiago' },
      { id: 'r2', text: 'Lima' },
    ],
    correctPairs: [
      { leftId: 'l1', rightId: 'r1' },
      { leftId: 'l2', rightId: 'r2' },
    ],
  },
  ordering: {
    items: [
      { id: 'a', text: 'Primero' },
      { id: 'b', text: 'Segundo' },
    ],
    correctOrder: ['a', 'b'],
  },
  gap_fill: {
    textWithGaps: 'El sol ___ por el este.',
    gaps: [{ position: 0, acceptedAnswers: ['sale', 'aparece'] }],
  },
} satisfies Record<ItemType, Record<string, unknown>> as Record<
  ItemType,
  Item['content']
>;

const ALL_ITEM_TYPES = Object.keys(VALID_CONTENT) as ItemType[];

/**
 * Mock mínimo del cliente Drizzle: cubre la cadena insert().values().returning()
 * y los select() que ejecuta create() (getById + tags). Permite verificar que un
 * content VÁLIDO NO es rechazado por la validación (la creación llega a la DB).
 */
function dbMockForCreate(createdRow: Item) {
  const selectChain = {
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    // getById hace `select().from().where()` (item) y luego un select de tags.
    where: jest.fn().mockResolvedValue([createdRow]),
  };
  return {
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        returning: jest.fn().mockResolvedValue([createdRow]),
      }),
    }),
    select: jest.fn().mockReturnValue(selectChain),
  } as never;
}

function createDto(type: ItemType, content: Record<string, unknown>): CreateItemDto {
  return {
    position: 0,
    type,
    content,
    status: 'draft',
    source: 'custom',
  } as CreateItemDto;
}

describe('ItemsService.create — validación de content polimórfico', () => {
  it.each(ALL_ITEM_TYPES)(
    'acepta content válido para el tipo %s',
    async (type) => {
      const created = item({ type, content: VALID_CONTENT[type] });
      const svc = new ItemsService(dbMockForCreate(created));
      await expect(
        svc.create(createDto(type, VALID_CONTENT[type]), user()),
      ).resolves.toBeDefined();
    },
  );

  it('rechaza multiple_choice sin alternativas', async () => {
    const svc = makeService();
    await expect(
      svc.create(createDto('multiple_choice', { stem: '¿Algo?' }), user()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza multiple_choice con una sola alternativa (min 2)', async () => {
    const svc = makeService();
    await expect(
      svc.create(
        createDto('multiple_choice', {
          stem: '¿Algo?',
          alternatives: [{ key: 'A', text: 'Sí', isCorrect: true }],
        }),
        user(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza true_false sin correctAnswer', async () => {
    const svc = makeService();
    await expect(
      svc.create(createDto('true_false', { stem: 'El cielo es azul' }), user()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza gap_fill sin gaps', async () => {
    const svc = makeService();
    await expect(
      svc.create(
        createDto('gap_fill', { textWithGaps: 'El sol ___ por el este.' }),
        user(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza matching sin correctPairs', async () => {
    const svc = makeService();
    await expect(
      svc.create(
        createDto('matching', {
          leftItems: [{ id: 'l1', text: 'A' }, { id: 'l2', text: 'B' }],
          rightItems: [{ id: 'r1', text: '1' }, { id: 'r2', text: '2' }],
        }),
        user(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza content del TIPO EQUIVOCADO (content MC declarado como gap_fill)', async () => {
    const svc = makeService();
    await expect(
      svc.create(createDto('gap_fill', VALID_CONTENT.multiple_choice), user()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el mensaje de error nombra el tipo de ítem', async () => {
    const svc = makeService();
    await expect(
      svc.create(createDto('true_false', {}), user()),
    ).rejects.toThrow(/true_false/);
  });

  it('CERO REGRESIÓN: un multiple_choice con shape del seed (incl. correctKey extra) sigue validando', async () => {
    // El seed e2e produce content MC con un campo extra `correctKey` además de
    // stem + alternatives[{key,text,isCorrect}]. El schema canónico (z.object, sin
    // passthrough) descarta la clave extra pero NO la rechaza, así que el ítem
    // productivo DIA debe seguir creándose sin error.
    const seedLikeContent = {
      stem: 'Según el texto, ¿dónde encontró Pedro al perro?',
      correctKey: 'A',
      alternatives: [
        { key: 'A', text: 'En el parque', isCorrect: true },
        { key: 'B', text: 'En la escuela', isCorrect: false },
        { key: 'C', text: 'En la playa', isCorrect: false },
        { key: 'D', text: 'En el mercado', isCorrect: false },
      ],
    };
    const created = item({ type: 'multiple_choice', content: seedLikeContent as Item['content'] });
    const svc = new ItemsService(dbMockForCreate(created));
    await expect(
      svc.create(createDto('multiple_choice', seedLikeContent), user()),
    ).resolves.toBeDefined();
  });
});

describe('ItemsService.update — validación de content polimórfico', () => {
  /**
   * Mock para update: getByIdRaw (select item), snapshot de versión (insert),
   * y el update().set().where().returning(). La validación de content corre antes
   * del update(); para casos inválidos lanza antes de tocar la DB de escritura.
   */
  function dbMockForUpdate(existing: Item) {
    return {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([existing]),
      }),
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([{ id: 'v1' }]),
        }),
      }),
      update: jest.fn().mockReturnValue({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest
              .fn()
              .mockResolvedValue([{ ...existing, content: existing.content }]),
          }),
        }),
      }),
    } as never;
  }

  it('acepta nuevo content válido para el type existente', async () => {
    const existing = item({
      orgId: 'org-1',
      type: 'multiple_choice',
      content: VALID_CONTENT.multiple_choice,
    });
    const svc = new ItemsService(dbMockForUpdate(existing));
    const dto = { content: VALID_CONTENT.multiple_choice } as UpdateItemDto;
    await expect(svc.update('item-1', dto, user({ orgId: 'org-1' }))).resolves.toBeDefined();
  });

  it('rechaza nuevo content inválido para el type existente', async () => {
    const existing = item({
      orgId: 'org-1',
      type: 'true_false',
      content: VALID_CONTENT.true_false,
    });
    const svc = new ItemsService(dbMockForUpdate(existing));
    const dto = { content: { stem: 'sin correctAnswer' } } as UpdateItemDto;
    await expect(
      svc.update('item-1', dto, user({ orgId: 'org-1' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('al cambiar solo el type, re-valida el content existente contra el nuevo type', async () => {
    // content MC existente, se cambia el type a gap_fill sin reenviar content =>
    // el content existente ya no es válido para gap_fill => rechazo.
    const existing = item({
      orgId: 'org-1',
      type: 'multiple_choice',
      content: VALID_CONTENT.multiple_choice,
    });
    const svc = new ItemsService(dbMockForUpdate(existing));
    const dto = { type: 'gap_fill' } as UpdateItemDto;
    await expect(
      svc.update('item-1', dto, user({ orgId: 'org-1' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('no valida content cuando ni type ni content cambian (cero regresión)', async () => {
    const existing = item({
      orgId: 'org-1',
      type: 'multiple_choice',
      content: VALID_CONTENT.multiple_choice,
    });
    const svc = new ItemsService(dbMockForUpdate(existing));
    const dto = { position: 5 } as UpdateItemDto;
    await expect(
      svc.update('item-1', dto, user({ orgId: 'org-1' })),
    ).resolves.toBeDefined();
  });
});

// ── getContentForAssistant — normalización PII-free (H21.6b) ─────────────────
//
// Resuelve un ítem (por itemId) y aplana el `content` polimórfico a la forma
// común del asistente. Verificamos el normalizador para multiple_choice (con su
// clave correcta) y la robustez ante otros tipos sin alternativas.

describe('ItemsService.getContentForAssistant — normalización', () => {
  /**
   * Mock que devuelve, en orden, el ítem (resolveItemForAssistant) y luego sus
   * tags de habilidad (loadPrimarySkillName). Cada `select()` se consume una vez.
   */
  function dbMockForAssistant(row: Item, skillName: string | null) {
    const itemSelect = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([row]),
    };
    const skillSelect = {
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest
        .fn()
        .mockResolvedValue(skillName === null ? [] : [{ name: skillName }]),
    };
    const select = jest
      .fn()
      .mockReturnValueOnce(itemSelect)
      .mockReturnValueOnce(skillSelect);
    return { select } as never;
  }

  const ITEM_UUID = '11111111-1111-1111-1111-111111111111';

  it('normaliza multiple_choice: stem, alternatives clave→texto y correctKey', async () => {
    const row = item({
      id: ITEM_UUID,
      orgId: 'org-1',
      position: 4,
      type: 'multiple_choice',
      content: {
        stem: '¿2 + 2?',
        alternatives: [
          { key: 'A', text: '3', isCorrect: false },
          { key: 'B', text: '4', isCorrect: true },
        ],
      } as Item['content'],
    });
    const svc = new ItemsService(dbMockForAssistant(row, 'Operatoria'));

    const result = await svc.getContentForAssistant(user({ orgId: 'org-1' }), {
      itemId: ITEM_UUID,
    });

    expect(result).toEqual({
      itemId: ITEM_UUID,
      position: 4,
      type: 'multiple_choice',
      stem: '¿2 + 2?',
      alternatives: [
        { key: 'A', text: '3' },
        { key: 'B', text: '4' },
      ],
      correctKey: 'B',
      skillName: 'Operatoria',
    });
  });

  it('true_false: sin alternativas, correctKey en V/F', async () => {
    const row = item({
      id: ITEM_UUID,
      orgId: 'org-1',
      position: 1,
      type: 'true_false',
      content: { stem: 'El cielo es azul', correctAnswer: true } as Item['content'],
    });
    const svc = new ItemsService(dbMockForAssistant(row, null));

    const result = await svc.getContentForAssistant(user({ orgId: 'org-1' }), {
      itemId: ITEM_UUID,
    });

    expect(result.alternatives).toEqual([]);
    expect(result.correctKey).toBe('V');
    expect(result.stem).toBe('El cielo es azul');
    expect(result.skillName).toBeNull();
  });

  it('open_ended: stem desde prompt, alternatives vacío, correctKey null', async () => {
    const row = item({
      id: ITEM_UUID,
      orgId: 'org-1',
      position: 2,
      type: 'open_ended',
      content: { prompt: 'Explica el ciclo del agua' } as Item['content'],
    });
    const svc = new ItemsService(dbMockForAssistant(row, null));

    const result = await svc.getContentForAssistant(user({ orgId: 'org-1' }), {
      itemId: ITEM_UUID,
    });

    expect(result.stem).toBe('Explica el ciclo del agua');
    expect(result.alternatives).toEqual([]);
    expect(result.correctKey).toBeNull();
  });

  it('lanza NotFound cuando el ítem no existe', async () => {
    const itemSelect = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([]),
    };
    const svc = new ItemsService({
      select: jest.fn().mockReturnValue(itemSelect),
    } as never);

    await expect(
      svc.getContentForAssistant(user({ orgId: 'org-1' }), { itemId: ITEM_UUID }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('exige itemId o (assessmentId + position)', async () => {
    const svc = makeService();
    await expect(
      svc.getContentForAssistant(user({ orgId: 'org-1' }), {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  /**
   * Regresión §5.2: al resolver por `assessmentId + position`, la lectura de
   * `assessments` (tabla con RLS) DEBE correr dentro de `withOrgContext` para
   * fijar `app.current_org_id`. Sin eso, bajo `soe_app` (sin BYPASSRLS) el RLS
   * devuelve 0 filas → NotFound (era el mismo 404 del hub en AWS). El mock espía
   * `transaction`: si alguien quitara el withOrgContext, no se llamaría y el test
   * fallaría. Las lecturas de `items`/tags NO son RLS y corren en `this.db`.
   */
  it('resuelve por assessmentId+position dentro de withOrgContext (RLS §5.2)', async () => {
    const row = item({
      id: ITEM_UUID,
      orgId: 'org-1',
      position: 3,
      type: 'true_false',
      content: { stem: '¿Verdadero?', correctAnswer: false } as Item['content'],
    });

    // Dentro de la transacción de withOrgContext: assessmentId → instrumentId.
    const assessmentSelect = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([{ instrumentId: 'instr-1' }]),
    };
    // withOrgContext fija app.current_org_id vía tx.execute(set_config) antes de fn.
    const tx = {
      select: jest.fn().mockReturnValue(assessmentSelect),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const transaction = jest.fn((fn: (t: unknown) => unknown) => fn(tx));

    // this.db (fuera de contexto): item por instrumentId+position, luego su skill.
    const itemSelect = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([row]),
    };
    const skillSelect = {
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    };
    const select = jest
      .fn()
      .mockReturnValueOnce(itemSelect)
      .mockReturnValueOnce(skillSelect);

    const svc = new ItemsService({ select, transaction } as never);

    const result = await svc.getContentForAssistant(user({ orgId: 'org-1' }), {
      assessmentId: '99999999-9999-9999-9999-999999999999',
      position: 3,
    });

    expect(result.itemId).toBe(ITEM_UUID);
    // La lectura de `assessments` (RLS) corrió dentro de withOrgContext:
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.select).toHaveBeenCalledTimes(1);
  });
});
