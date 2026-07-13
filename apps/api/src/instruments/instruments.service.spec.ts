import { ForbiddenException } from '@nestjs/common';
import { instruments, instrumentSections, sectionAttachments } from '@soe/db';
import { InstrumentsService } from './instruments.service';
import type { FilesService } from '../files/files.service';
import type { JwtPayload } from '../auth/jwt-payload.types';
import type { Database, Instrument } from '@soe/db';
import type { CreateSectionDto, UpdateSectionDto } from './dto/instrument.dto';

/** Stub de FilesService: los tests de este archivo no ejercitan el PDF del enunciado. */
function makeFiles(): FilesService {
  return {
    buildDownloadUrl: () => undefined,
    getLatestByOwner: () => Promise.resolve(null),
  } as unknown as FilesService;
}

function makeService() {
  const db = {} as never;
  return new InstrumentsService(db, makeFiles());
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

function instrument(overrides: Partial<Instrument> = {}): Instrument {
  return {
    id: 'inst-1',
    orgId: 'org-1',
    taxonomyId: null,
    name: 'DIA Lenguaje 3ro',
    shortName: null,
    type: 'dia',
    subjectId: null,
    gradeId: null,
    year: 2024,
    version: null,
    isOfficial: false,
    status: 'draft',
    gradingScaleId: null,
    config: {},
    createdById: 'u1',
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Instrument;
}

// ── Recording fake DB (sin dependencia de Postgres) ──────────────────────────
// El repo no tiene aún un harness de DB de integración para este módulo (todos los
// specs usan un `db` falso). Para verificar de forma determinística que el service
// persiste pasaje + adjuntos y aplica la estrategia de reemplazo en updateSection,
// se usa un fake que graba las operaciones de escritura. El cascade de
// `section_attachments` (onDelete) se valida vía revisión del SQL de migración.

type WriteRecord = { table: unknown; values: unknown };

/** Cadena `select().from().where().orderBy()` resoluble a filas. */
class ThenableRows implements PromiseLike<unknown[]> {
  constructor(private readonly rows: unknown[]) {}
  where(): this {
    return this;
  }
  orderBy(): this {
    return this;
  }
  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.rows).then(onfulfilled, onrejected);
  }
}

/** Resultado de `insert().values()`: awaitable y con `.returning()`. */
class InsertResult implements PromiseLike<unknown> {
  constructor(private readonly returningRows: unknown[]) {}
  returning(): Promise<unknown[]> {
    return Promise.resolve(this.returningRows);
  }
  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(undefined).then(onfulfilled, onrejected);
  }
}

class FakeDb {
  readonly inserts: WriteRecord[] = [];
  readonly updates: WriteRecord[] = [];
  readonly deletes: { table: unknown }[] = [];

  constructor(
    private readonly rowsByTable: Map<unknown, unknown[]>,
    private readonly insertReturning: Map<unknown, unknown[]>,
  ) {}

  select() {
    return {
      from: (table: unknown) => new ThenableRows(this.rowsByTable.get(table) ?? []),
    };
  }

  insert(table: unknown) {
    return {
      values: (values: unknown) => {
        this.inserts.push({ table, values });
        return new InsertResult(this.insertReturning.get(table) ?? []);
      },
    };
  }

  update(table: unknown) {
    return {
      set: (values: unknown) => ({
        where: (): Promise<void> => {
          this.updates.push({ table, values });
          return Promise.resolve();
        },
      }),
    };
  }

  delete(table: unknown) {
    return {
      where: (): Promise<void> => {
        this.deletes.push({ table });
        return Promise.resolve();
      },
    };
  }

  transaction<T>(cb: (tx: FakeDb) => Promise<T>): Promise<T> {
    return cb(this);
  }
}

function recordOf(records: WriteRecord[], table: unknown): WriteRecord | undefined {
  return records.find((r) => r.table === table);
}

describe('InstrumentsService — pasaje y adjuntos de sección', () => {
  const editor = user({ orgId: 'org-1', role: 'school_admin' });

  function setup() {
    const inst = instrument({ id: 'inst-1', orgId: 'org-1' });
    const sectionRow = {
      id: 'sec-1',
      instrumentId: 'inst-1',
      name: 'Comprensión lectora',
      type: 'multiple_choice',
      order: 0,
      maxPoints: null,
      timeLimitMin: null,
      instructions: null,
      passageTitle: 'El cuento',
      passageText: 'Había una vez',
      passageFormat: 'plain',
      config: {},
    };
    const fake = new FakeDb(
      new Map<unknown, unknown[]>([
        [instruments, [inst]],
        [instrumentSections, [sectionRow]],
        [sectionAttachments, []],
      ]),
      new Map<unknown, unknown[]>([[instrumentSections, [{ id: 'sec-1' }]]]),
    );
    const svc = new InstrumentsService(fake as unknown as Database, makeFiles());
    return { svc, fake };
  }

  it('persiste el pasaje en columnas tipadas al crear una sección', async () => {
    const { svc, fake } = setup();
    const dto: CreateSectionDto = {
      name: 'Comprensión lectora',
      type: 'multiple_choice',
      order: 0,
      passage: { title: 'El cuento', text: 'Había una vez', format: 'plain' },
    };

    await svc.createSection('inst-1', dto, editor);

    const sectionInsert = recordOf(fake.inserts, instrumentSections);
    expect(sectionInsert).toBeDefined();
    expect(sectionInsert?.values).toMatchObject({
      passageTitle: 'El cuento',
      passageText: 'Había una vez',
      passageFormat: 'plain',
    });
  });

  it('inserta los adjuntos mapeando los campos del DTO', async () => {
    const { svc, fake } = setup();
    const dto: CreateSectionDto = {
      name: 'Comprensión lectora',
      type: 'multiple_choice',
      order: 0,
      passage: { title: 'El cuento', text: 'Había una vez', format: 'plain' },
      attachments: [{ kind: 'image', order: 0, note: 'Ilustración del cuento' }],
    };

    await svc.createSection('inst-1', dto, editor);

    const attachInsert = recordOf(fake.inserts, sectionAttachments);
    expect(attachInsert).toBeDefined();
    expect(Array.isArray(attachInsert?.values)).toBe(true);
    const rows = attachInsert?.values as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({
      sectionId: 'sec-1',
      kind: 'image',
      order: 0,
      note: 'Ilustración del cuento',
      storageKey: null,
      meta: {},
    });
  });

  it('updateSection con `attachments` definido reemplaza (delete + insert)', async () => {
    const { svc, fake } = setup();
    const dto: UpdateSectionDto = {
      attachments: [{ kind: 'pdf', order: 0, fileName: 'lectura.pdf' }],
    };

    await svc.updateSection('inst-1', 'sec-1', dto, editor);

    expect(fake.deletes.some((d) => d.table === sectionAttachments)).toBe(true);
    expect(recordOf(fake.inserts, sectionAttachments)).toBeDefined();
  });

  it('updateSection sin `attachments` no toca los adjuntos', async () => {
    const { svc, fake } = setup();
    const dto: UpdateSectionDto = { name: 'Nuevo nombre' };

    await svc.updateSection('inst-1', 'sec-1', dto, editor);

    expect(fake.deletes.some((d) => d.table === sectionAttachments)).toBe(false);
    expect(recordOf(fake.inserts, sectionAttachments)).toBeUndefined();
    expect(recordOf(fake.updates, instrumentSections)).toBeDefined();
  });

  it('updateSection con `passage` reescribe las columnas del pasaje', async () => {
    const { svc, fake } = setup();
    const dto: UpdateSectionDto = {
      passage: { title: 'Otro título', text: 'Nuevo texto', format: 'markdown' },
    };

    await svc.updateSection('inst-1', 'sec-1', dto, editor);

    const update = recordOf(fake.updates, instrumentSections);
    expect(update?.values).toMatchObject({
      passageTitle: 'Otro título',
      passageText: 'Nuevo texto',
      passageFormat: 'markdown',
    });
  });
});

describe('InstrumentsService.assertVisible', () => {
  const svc = makeService();

  it('allows viewing official instruments for any user', () => {
    expect(() =>
      svc.assertVisible(instrument({ isOfficial: true, orgId: null }), user()),
    ).not.toThrow();
  });

  it('allows viewing instruments from own org', () => {
    expect(() =>
      svc.assertVisible(instrument({ orgId: 'org-1' }), user({ orgId: 'org-1' })),
    ).not.toThrow();
  });

  it('blocks instruments from another org', () => {
    expect(() =>
      svc.assertVisible(instrument({ orgId: 'other' }), user({ orgId: 'org-1' })),
    ).toThrow(ForbiddenException);
  });

  it('platform_admin can see anything', () => {
    expect(() =>
      svc.assertVisible(
        instrument({ orgId: 'other' }),
        user({ role: 'platform_admin' }),
      ),
    ).not.toThrow();
  });
});

describe('InstrumentsService.assertEditable', () => {
  const svc = makeService();

  it('blocks official instruments for non-admin', () => {
    expect(() =>
      svc.assertEditable(
        instrument({ isOfficial: true, orgId: null }),
        user({ role: 'school_admin' }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows platform_admin to edit official instruments', () => {
    expect(() =>
      svc.assertEditable(
        instrument({ isOfficial: true, orgId: null }),
        user({ role: 'platform_admin' }),
      ),
    ).not.toThrow();
  });

  it('allows editing custom instruments from own org', () => {
    expect(() =>
      svc.assertEditable(
        instrument({ orgId: 'org-1' }),
        user({ orgId: 'org-1', role: 'school_admin' }),
      ),
    ).not.toThrow();
  });

  it('blocks editing instruments from another org', () => {
    expect(() =>
      svc.assertEditable(
        instrument({ orgId: 'other' }),
        user({ orgId: 'org-1', role: 'school_admin' }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('platform_admin can edit instruments from any org', () => {
    expect(() =>
      svc.assertEditable(
        instrument({ orgId: 'other' }),
        user({ role: 'platform_admin' }),
      ),
    ).not.toThrow();
  });
});
