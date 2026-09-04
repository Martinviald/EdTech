import type { Database } from '@soe/db';
import { buildOmrQrPayload, buildOmrShortQrPayload } from '@soe/types';
import type { ScannedPage } from '@soe/types';
import { QrIdentityResolver } from './qr-identity.resolver';

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

const SHEET_ID = '9f2c1a44-3b7e-4c11-9a0d-5e8f7b2c1d33';
const HASH = 'a3f9c1e70b4d2856';
const OTHER_HASH = 'ffffffffffffffff';
const SHORT_CODE = 0x0a1b2c3d;
const CONTEXT = { printRunId: 'run-1', specHash: HASH };

function qr(overrides: Partial<Parameters<typeof buildOmrQrPayload>[0]> = {}): string {
  return buildOmrQrPayload({
    printedSheetId: SHEET_ID,
    layoutHash: HASH,
    pageIndex: 0,
    pageCount: 2,
    ...overrides,
  });
}

function makePage(raw: string | null): ScannedPage {
  return {
    pageIndex: 0,
    imageSha256: 'a'.repeat(64),
    quality: { ok: true, sharpness: 0.8, glare: 0.05, fiducialsFound: 4, rejectReason: null },
    identity: { mode: 'qr', raw, confidence: raw === null ? 0 : 1 },
    marks: [],
    pageThumbJpegBase64: null,
  };
}

function sheetRow(overrides: Record<string, unknown> = {}) {
  return {
    printedSheetId: SHEET_ID,
    studentId: 'student-1',
    specHash: HASH,
    spec: { pageCount: 2 },
    studentFirstName: 'Ana',
    studentLastName: 'Pérez',
    ...overrides,
  };
}

describe('QrIdentityResolver', () => {
  it('expone mode qr', () => {
    expect(new QrIdentityResolver(makeDb([])).mode).toBe('qr');
  });

  it('caso feliz: candidato con studentId, confianza 1 y sin confirmación humana', async () => {
    const raw = qr();
    const resolver = new QrIdentityResolver(makeDb([[sheetRow()]]));

    const candidate = await resolver.resolve('org-1', makePage(raw), CONTEXT);

    expect(candidate).toEqual({
      printedSheetId: SHEET_ID,
      studentId: 'student-1',
      confidence: 1,
      evidence: { qr: raw, alumno: 'Ana Pérez' },
      needsHumanConfirmation: false,
      batchRejection: null,
    });
  });

  it('QR ilegible (raw null): candidato vacío para revisión, sin consultar la base', async () => {
    const db = makeDb([]);
    const resolver = new QrIdentityResolver(db);

    const candidate = await resolver.resolve('org-1', makePage(null), CONTEXT);

    expect(candidate.printedSheetId).toBeNull();
    expect(candidate.studentId).toBeNull();
    expect(candidate.needsHumanConfirmation).toBe(true);
    expect(candidate.batchRejection).toBeNull();
    expect(candidate.evidence).toEqual({ motivo: 'qr_ilegible', qr: null });
    expect(db.__selectCount()).toBe(0);
  });

  it('QR con payload ajeno al formato academos:v1: candidato vacío para revisión', async () => {
    const db = makeDb([]);
    const resolver = new QrIdentityResolver(db);

    const candidate = await resolver.resolve('org-1', makePage('https://example.com/otra-cosa'), CONTEXT);

    expect(candidate.studentId).toBeNull();
    expect(candidate.needsHumanConfirmation).toBe(true);
    expect(candidate.evidence.motivo).toBe('qr_ilegible');
    expect(db.__selectCount()).toBe(0);
  });

  it('hoja inexistente: candidato vacío con evidencia, nunca excepción', async () => {
    const raw = qr();
    const resolver = new QrIdentityResolver(makeDb([[]]));

    const candidate = await resolver.resolve('org-1', makePage(raw), CONTEXT);

    expect(candidate.printedSheetId).toBeNull();
    expect(candidate.studentId).toBeNull();
    expect(candidate.needsHumanConfirmation).toBe(true);
    expect(candidate.batchRejection).toBeNull();
    expect(candidate.evidence).toEqual({
      motivo: 'hoja_no_encontrada',
      qr: raw,
      printedSheetId: SHEET_ID,
    });
  });

  it('hoja de otra org: la query filtra por orgId (y RLS devuelve 0 filas igual) → candidato vacío', async () => {
    const raw = qr();
    const resolver = new QrIdentityResolver(makeDb([[]]));

    const candidate = await resolver.resolve('org-ajena', makePage(raw), CONTEXT);

    expect(candidate.studentId).toBeNull();
    expect(candidate.needsHumanConfirmation).toBe(true);
    expect(candidate.evidence.motivo).toBe('hoja_no_encontrada');
  });

  it('layoutHash distinto al specHash de la tirada: batchRejection con el motivo G1', async () => {
    const raw = qr();
    const resolver = new QrIdentityResolver(makeDb([[sheetRow({ specHash: OTHER_HASH })]]));

    const candidate = await resolver.resolve('org-1', makePage(raw), CONTEXT);

    expect(candidate.batchRejection).not.toBeNull();
    expect(candidate.batchRejection?.reason).toContain('editado después de imprimir');
    expect(candidate.batchRejection?.reason).toContain(HASH);
    expect(candidate.batchRejection?.reason).toContain(OTHER_HASH);
    expect(candidate.printedSheetId).toBe(SHEET_ID);
    expect(candidate.studentId).toBeNull();
  });

  it('pageIndex fuera del rango del spec: candidato vacío con evidencia page_index_fuera_de_rango', async () => {
    const raw = qr({ pageIndex: 1, pageCount: 2 });
    const resolver = new QrIdentityResolver(makeDb([[sheetRow({ spec: { pageCount: 1 } })]]));

    const candidate = await resolver.resolve('org-1', makePage(raw), CONTEXT);

    expect(candidate.printedSheetId).toBeNull();
    expect(candidate.studentId).toBeNull();
    expect(candidate.needsHumanConfirmation).toBe(true);
    expect(candidate.batchRejection).toBeNull();
    expect(candidate.evidence).toEqual({
      motivo: 'page_index_fuera_de_rango',
      qr: raw,
      pageIndex: 1,
      pageCount: 1,
    });
  });

  it('hoja de reserva (studentId null): mantiene la hoja y pide confirmación humana (G8)', async () => {
    const raw = qr();
    const resolver = new QrIdentityResolver(
      makeDb([[sheetRow({ studentId: null, studentFirstName: null, studentLastName: null })]]),
    );

    const candidate = await resolver.resolve('org-1', makePage(raw), CONTEXT);

    expect(candidate).toEqual({
      printedSheetId: SHEET_ID,
      studentId: null,
      confidence: 0,
      evidence: { motivo: 'hoja_de_reserva', qr: raw },
      needsHumanConfirmation: true,
      batchRejection: null,
    });
  });

  it('payload corto: resuelve la hoja por short_code con studentId y confianza 1', async () => {
    const raw = buildOmrShortQrPayload({ shortCode: SHORT_CODE, pageIndex: 0 });
    const resolver = new QrIdentityResolver(makeDb([[sheetRow()]]));

    const candidate = await resolver.resolve('org-1', makePage(raw), CONTEXT);

    expect(candidate).toEqual({
      printedSheetId: SHEET_ID,
      studentId: 'student-1',
      confidence: 1,
      evidence: { qr: raw, alumno: 'Ana Pérez' },
      needsHumanConfirmation: false,
      batchRejection: null,
    });
  });

  it('payload corto sin hoja en la org: candidato vacío con el shortCode en la evidencia', async () => {
    const raw = buildOmrShortQrPayload({ shortCode: SHORT_CODE, pageIndex: 0 });
    const resolver = new QrIdentityResolver(makeDb([[]]));

    const candidate = await resolver.resolve('org-1', makePage(raw), CONTEXT);

    expect(candidate.printedSheetId).toBeNull();
    expect(candidate.evidence).toEqual({
      motivo: 'hoja_no_encontrada',
      qr: raw,
      shortCode: SHORT_CODE,
    });
  });

  it('payload corto de una hoja de otro diseño: batchRejection G1 comparando contra el lote', async () => {
    const raw = buildOmrShortQrPayload({ shortCode: SHORT_CODE, pageIndex: 0 });
    const resolver = new QrIdentityResolver(makeDb([[sheetRow({ specHash: OTHER_HASH })]]));

    const candidate = await resolver.resolve('org-1', makePage(raw), CONTEXT);

    expect(candidate.batchRejection).not.toBeNull();
    expect(candidate.batchRejection?.reason).toContain(OTHER_HASH);
    expect(candidate.batchRejection?.reason).toContain(HASH);
    expect(candidate.batchRejection?.reason).toContain('no coincide con el diseño de la tirada de este lote');
    expect(candidate.printedSheetId).toBe(SHEET_ID);
  });

  it('payload corto con pageIndex fuera del spec: candidato vacío para revisión', async () => {
    const raw = buildOmrShortQrPayload({ shortCode: SHORT_CODE, pageIndex: 1 });
    const resolver = new QrIdentityResolver(makeDb([[sheetRow({ spec: { pageCount: 1 } })]]));

    const candidate = await resolver.resolve('org-1', makePage(raw), CONTEXT);

    expect(candidate.printedSheetId).toBeNull();
    expect(candidate.evidence.motivo).toBe('page_index_fuera_de_rango');
  });
});
