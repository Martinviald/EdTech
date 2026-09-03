import type { Database } from '@soe/db';
import { buildOmrQrPayload, buildOmrShortQrPayload } from '@soe/types';
import type { ScannedPage } from '@soe/types';
import { RutBubbleResolver } from './rut-bubble.resolver';

type QueryBuilder = {
  from: (..._: unknown[]) => QueryBuilder;
  where: (..._: unknown[]) => QueryBuilder;
  innerJoin: (..._: unknown[]) => QueryBuilder;
  leftJoin: (..._: unknown[]) => QueryBuilder;
  limit: (..._: unknown[]) => QueryBuilder;
  then: <T>(resolve: (rows: T[]) => unknown) => Promise<unknown>;
};

type DbMock = Database & { __selectCount: () => number };

function makeDb(selectResults: unknown[][]): DbMock {
  let selectIdx = 0;

  function buildSelectChain(rows: unknown[]): QueryBuilder {
    const chain: QueryBuilder = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      limit: () => chain,
      then: (resolve) => Promise.resolve(rows as never).then(resolve as never),
    };
    return chain;
  }

  const db = {
    select: () => {
      const rows = selectResults[selectIdx] ?? [];
      selectIdx++;
      return buildSelectChain(rows);
    },
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    __selectCount: () => selectIdx,
  } as unknown as DbMock;

  return db;
}

const RUN_ID = '66666666-6666-4666-8666-666666666666';
const SHEET_ID = '77777777-7777-4777-8777-777777777777';
const LAYOUT_HASH = 'a3f9c1e70b4d2856';
const CONTEXT = { printRunId: RUN_ID, specHash: LAYOUT_HASH };
const QR_RAW = buildOmrQrPayload({
  printedSheetId: SHEET_ID,
  layoutHash: LAYOUT_HASH,
  pageIndex: 0,
  pageCount: 2,
});

function makePage(
  raw: string | null,
  confidence = 0.9,
  qrRaw: string | null = QR_RAW,
): ScannedPage {
  return {
    pageIndex: 0,
    imageSha256: 'a'.repeat(64),
    quality: { ok: true, sharpness: 0.8, glare: 0.05, fiducialsFound: 4, rejectReason: null },
    identity: { mode: 'rut_bubbles', raw, confidence, qrRaw },
    marks: [],
    pageThumbJpegBase64: null,
  };
}

function sheetRow(overrides: Record<string, unknown> = {}) {
  return {
    printedSheetId: SHEET_ID,
    specHash: LAYOUT_HASH,
    spec: { pageCount: 2 },
    ...overrides,
  };
}

function rosterRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'student-1',
    rut: '12.345.678-5',
    firstName: 'Ana',
    lastName: 'Pérez',
    ...overrides,
  };
}

describe('RutBubbleResolver', () => {
  it('expone mode rut_bubbles', () => {
    expect(new RutBubbleResolver(makeDb([])).mode).toBe('rut_bubbles');
  });

  it('CD-15: resuelve la copia física por el QR de esquina y el alumno por el RUT', async () => {
    const resolver = new RutBubbleResolver(makeDb([[sheetRow()], [rosterRow()]]));

    const candidate = await resolver.resolve('org-1', makePage('123456785', 0.87), CONTEXT);

    expect(candidate).toEqual({
      printedSheetId: SHEET_ID,
      studentId: 'student-1',
      confidence: 0.87,
      evidence: { qr: QR_RAW, rut: '12345678-5', alumno: 'Ana Pérez' },
      needsHumanConfirmation: false,
      batchRejection: null,
    });
  });

  it('qrRaw null: cola manual sin consultar la base (la copia física no se puede anclar)', async () => {
    const db = makeDb([]);
    const resolver = new RutBubbleResolver(db);

    const candidate = await resolver.resolve('org-1', makePage('123456785', 0.9, null), CONTEXT);

    expect(candidate.printedSheetId).toBeNull();
    expect(candidate.studentId).toBeNull();
    expect(candidate.needsHumanConfirmation).toBe(true);
    expect(candidate.evidence).toEqual({
      motivo: 'qr_esquina_ilegible',
      qr: null,
      rut: '123456785',
    });
    expect(db.__selectCount()).toBe(0);
  });

  it('payload de esquina no parseable: cola manual sin consultar la base', async () => {
    const db = makeDb([]);
    const resolver = new RutBubbleResolver(db);

    const candidate = await resolver.resolve(
      'org-1',
      makePage('123456785', 0.9, 'no-es-un-payload'),
      CONTEXT,
    );

    expect(candidate.printedSheetId).toBeNull();
    expect(candidate.evidence.motivo).toBe('qr_esquina_ilegible');
    expect(db.__selectCount()).toBe(0);
  });

  it('hoja del QR inexistente en la org: cola manual con el printedSheetId en la evidencia', async () => {
    const resolver = new RutBubbleResolver(makeDb([[]]));

    const candidate = await resolver.resolve('org-1', makePage('123456785'), CONTEXT);

    expect(candidate.printedSheetId).toBeNull();
    expect(candidate.needsHumanConfirmation).toBe(true);
    expect(candidate.evidence).toMatchObject({
      motivo: 'hoja_no_encontrada',
      printedSheetId: SHEET_ID,
    });
  });

  it('G1: hash del QR distinto al layout de la hoja rechaza el lote entero con ambos hashes', async () => {
    const resolver = new RutBubbleResolver(
      makeDb([[sheetRow({ specHash: 'ffff000011112222' })]]),
    );

    const candidate = await resolver.resolve('org-1', makePage('123456785'), CONTEXT);

    expect(candidate.batchRejection).not.toBeNull();
    expect(candidate.batchRejection?.reason).toContain(LAYOUT_HASH);
    expect(candidate.batchRejection?.reason).toContain('ffff000011112222');
    expect(candidate.studentId).toBeNull();
  });

  it('pageIndex del QR fuera del rango del spec: cola manual', async () => {
    const resolver = new RutBubbleResolver(makeDb([[sheetRow({ spec: { pageCount: 1 } })]]));
    const qrPage3 = buildOmrQrPayload({
      printedSheetId: SHEET_ID,
      layoutHash: LAYOUT_HASH,
      pageIndex: 3,
      pageCount: 4,
    });

    const candidate = await resolver.resolve('org-1', makePage('123456785', 0.9, qrPage3), CONTEXT);

    expect(candidate.printedSheetId).toBeNull();
    expect(candidate.evidence.motivo).toBe('page_index_fuera_de_rango');
  });

  it('raw null: la hoja queda anclada por el QR pero el alumno va a cola manual', async () => {
    const resolver = new RutBubbleResolver(makeDb([[sheetRow()]]));

    const candidate = await resolver.resolve('org-1', makePage(null), CONTEXT);

    expect(candidate.printedSheetId).toBe(SHEET_ID);
    expect(candidate.studentId).toBeNull();
    expect(candidate.needsHumanConfirmation).toBe(true);
    expect(candidate.batchRejection).toBeNull();
    expect(candidate.evidence).toMatchObject({ motivo: 'rut_ilegible', rut: null, qr: QR_RAW });
  });

  it('raw con caracteres fuera de dígitos/K: cola manual conservando la hoja', async () => {
    const resolver = new RutBubbleResolver(makeDb([[sheetRow()]]));

    const candidate = await resolver.resolve('org-1', makePage('12A45678K'), CONTEXT);

    expect(candidate.printedSheetId).toBe(SHEET_ID);
    expect(candidate.needsHumanConfirmation).toBe(true);
    expect(candidate.evidence.motivo).toBe('rut_ilegible');
  });

  it('DV inválido (módulo 11): cola manual conservando la hoja, sin consultar el roster', async () => {
    const db = makeDb([[sheetRow()]]);
    const resolver = new RutBubbleResolver(db);

    const candidate = await resolver.resolve('org-1', makePage('123456780'), CONTEXT);

    expect(candidate.printedSheetId).toBe(SHEET_ID);
    expect(candidate.studentId).toBeNull();
    expect(candidate.evidence).toMatchObject({ motivo: 'rut_dv_invalido', rut: '123456780' });
    expect(db.__selectCount()).toBe(1);
  });

  it('RUT válido sin match en el roster del curso: cola manual, JAMÁS matching difuso', async () => {
    const resolver = new RutBubbleResolver(
      makeDb([[sheetRow()], [rosterRow({ rut: '9.876.543-3', id: 'student-otro' })]]),
    );

    const candidate = await resolver.resolve('org-1', makePage('123456785'), CONTEXT);

    expect(candidate.printedSheetId).toBe(SHEET_ID);
    expect(candidate.studentId).toBeNull();
    expect(candidate.needsHumanConfirmation).toBe(true);
    expect(candidate.evidence).toMatchObject({ motivo: 'rut_sin_match', rut: '12345678-5' });
  });

  it('acepta el DV K, incluso en minúscula en la lectura', async () => {
    const resolver = new RutBubbleResolver(
      makeDb([[sheetRow()], [rosterRow({ rut: '20930578-K' })]]),
    );

    const candidate = await resolver.resolve('org-1', makePage('20930578k'), CONTEXT);

    expect(candidate.studentId).toBe('student-1');
    expect(candidate.evidence.rut).toBe('20930578-K');
  });

  it('RUT de 7 dígitos marcado con cero a la izquierda hace match con el roster', async () => {
    const resolver = new RutBubbleResolver(
      makeDb([[sheetRow()], [rosterRow({ rut: '9876543-3' })]]),
    );

    const candidate = await resolver.resolve('org-1', makePage('098765433'), CONTEXT);

    expect(candidate.studentId).toBe('student-1');
    expect(candidate.evidence.rut).toBe('9876543-3');
  });

  it('dos alumnos con el mismo RUT en el roster: cola manual con evidencia del conflicto', async () => {
    const resolver = new RutBubbleResolver(
      makeDb([[sheetRow()], [rosterRow(), rosterRow({ id: 'student-2', firstName: 'Beto' })]]),
    );

    const candidate = await resolver.resolve('org-1', makePage('123456785'), CONTEXT);

    expect(candidate.studentId).toBeNull();
    expect(candidate.needsHumanConfirmation).toBe(true);
    expect(candidate.evidence).toMatchObject({ motivo: 'rut_duplicado_en_roster', rut: '12345678-5' });
  });

  it('un RUT mal escrito en el roster no impide el match exacto con el resto', async () => {
    const resolver = new RutBubbleResolver(
      makeDb([[sheetRow()], [rosterRow({ id: 'student-sucio', rut: 'RUT PENDIENTE' }), rosterRow()]]),
    );

    const candidate = await resolver.resolve('org-1', makePage('123456785'), CONTEXT);

    expect(candidate.studentId).toBe('student-1');
  });

  it('QR de esquina con payload corto: ancla la hoja por short_code y resuelve el alumno', async () => {
    const shortQr = buildOmrShortQrPayload({ shortCode: 0x0a1b2c3d, pageIndex: 0 });
    const resolver = new RutBubbleResolver(makeDb([[sheetRow()], [rosterRow()]]));

    const candidate = await resolver.resolve(
      'org-1',
      makePage('123456785', 0.87, shortQr),
      CONTEXT,
    );

    expect(candidate.printedSheetId).toBe(SHEET_ID);
    expect(candidate.studentId).toBe('student-1');
    expect(candidate.evidence).toMatchObject({ qr: shortQr, rut: '12345678-5' });
  });

  it('payload corto de una hoja de otro diseño: G1 contra el hash del lote', async () => {
    const shortQr = buildOmrShortQrPayload({ shortCode: 0x0a1b2c3d, pageIndex: 0 });
    const resolver = new RutBubbleResolver(
      makeDb([[sheetRow({ specHash: 'ffff000011112222' })]]),
    );

    const candidate = await resolver.resolve(
      'org-1',
      makePage('123456785', 0.9, shortQr),
      CONTEXT,
    );

    expect(candidate.batchRejection).not.toBeNull();
    expect(candidate.batchRejection?.reason).toContain('ffff000011112222');
    expect(candidate.batchRejection?.reason).toContain(LAYOUT_HASH);
  });
});
