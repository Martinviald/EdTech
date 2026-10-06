import { BadRequestException, NotFoundException } from '@nestjs/common';
import { resolveEffectiveBandsForInstruments, type Database, type EffectiveBands } from '@soe/db';
import { masterBoardMatrixQuerySchema, type PerformanceBandInput, type UserRole } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { parseDtoOrBadRequest } from '../common/helpers/parse-dto.helper';
import { MasterBoardService } from './master-board.service';
import { loadMatrixRows, type MatrixRow } from './queries/matrix-rows.query';
import {
  loadLegacyTakeRows,
  loadProcessLinkSummaries,
  loadProcessResultCounts,
  loadProcessSiblingCandidates,
  loadProcessTakeRows,
  type ProcessSiblingCandidateRow,
} from './queries/takes.query';
import { loadTomaAssessmentRows, type TomaAssessmentRow } from './queries/toma.query';

jest.mock('./queries/takes.query');
jest.mock('./queries/toma.query');
jest.mock('./queries/matrix-rows.query');
jest.mock('@soe/db', () => ({
  ...jest.requireActual('@soe/db'),
  resolveEffectiveBandsForInstruments: jest.fn(),
}));

const mocked = {
  loadMatrixRows: jest.mocked(loadMatrixRows),
  loadLegacyTakeRows: jest.mocked(loadLegacyTakeRows),
  loadProcessLinkSummaries: jest.mocked(loadProcessLinkSummaries),
  loadProcessResultCounts: jest.mocked(loadProcessResultCounts),
  loadProcessSiblingCandidates: jest.mocked(loadProcessSiblingCandidates),
  loadProcessTakeRows: jest.mocked(loadProcessTakeRows),
  loadTomaAssessmentRows: jest.mocked(loadTomaAssessmentRows),
  resolveEffectiveBandsForInstruments: jest.mocked(resolveEffectiveBandsForInstruments),
};

const ORG = '00000000-0000-0000-0000-0000000000aa';
const YEAR = '00000000-0000-0000-0000-000000002026';
const PROCESS_E3 = '00000000-0000-0000-0000-0000000000e3';
const PROCESS_DIA = '00000000-0000-0000-0000-00000000d1a0';

const DIA_BANDS: PerformanceBandInput[] = [
  { id: 'b1', key: 'dia_nivel_1', label: 'Nivel I', order: 0, minThreshold: 0, maxThreshold: 0.35 },
  {
    id: 'b2',
    key: 'dia_nivel_2',
    label: 'Nivel II',
    order: 1,
    minThreshold: 0.35,
    maxThreshold: 0.73,
  },
  {
    id: 'b3',
    key: 'dia_nivel_3',
    label: 'Nivel III',
    order: 2,
    minThreshold: 0.73,
    maxThreshold: 1,
  },
];

function makeUser(): JwtPayload {
  const role: UserRole = 'school_admin';
  return {
    userId: 'user-1',
    orgId: ORG,
    email: 'admin@colegio.cl',
    name: 'Admin',
    isPlatformAdmin: false,
    roles: [role],
    activeRole: role,
    role,
  };
}

type QueryChain = {
  from: () => QueryChain;
  where: () => QueryChain;
  innerJoin: () => QueryChain;
  leftJoin: () => QueryChain;
  groupBy: () => QueryChain;
  orderBy: () => QueryChain;
  limit: () => QueryChain;
  then: <T>(resolve: (rows: T[]) => unknown) => Promise<unknown>;
};

function makeDb(selectResults: unknown[][]): Database {
  let index = 0;
  const next = (): QueryChain => {
    const rows = selectResults[index] ?? [];
    index += 1;
    const chain: QueryChain = {
      from: () => chain,
      where: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      groupBy: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve) => Promise.resolve(rows as never).then(resolve as never),
    };
    return chain;
  };
  const db = {
    select: next,
    selectDistinct: next,
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  return db as unknown as Database;
}

function tomaRow(overrides: Partial<TomaAssessmentRow> = {}): TomaAssessmentRow {
  return {
    assessmentId: 'a1',
    activeProcessId: null,
    instrumentId: 'i1',
    instrumentType: 'dia',
    subjectId: 's-math',
    gradeId: 'g4',
    applicationPeriod: 'intermedio',
    year: 2026,
    trackId: null,
    ...overrides,
  };
}

function matrixRow(overrides: Partial<MatrixRow> = {}): MatrixRow {
  return {
    gradeId: 'g4',
    gradeName: '4° básico',
    gradeOrder: 4,
    classGroupId: 'cg-a',
    classGroupName: '4°A',
    subjectId: 's-math',
    subjectName: 'Matemática',
    subjectShortName: 'MAT',
    trackId: null,
    trackName: null,
    trackShortName: null,
    trackOrder: null,
    fromElectiveInstrument: false,
    scoreSum: '50',
    maxSum: '100',
    studentsAssessed: 30,
    assessmentIds: ['a1'],
    instrumentIds: ['i1'],
    ...overrides,
  };
}

function sibling(overrides: Partial<ProcessSiblingCandidateRow>): ProcessSiblingCandidateRow {
  return {
    assessmentId: 'a1',
    processId: null,
    academicYearId: YEAR,
    gradeId: 'g-iv',
    instrumentId: 'i1',
    instrumentType: 'paes',
    applicationPeriod: null,
    subjectId: 's-math',
    trackId: 't-m1',
    ...overrides,
  };
}

function bandsFor(entries: Record<string, PerformanceBandInput[]>): Map<string, EffectiveBands> {
  return new Map(
    Object.entries(entries).map(([id, bands]) => [id, { bands, source: 'own' as const }]),
  );
}

const YEARS_ROW = [{ id: YEAR, year: 2026, isCurrent: true }];

beforeEach(() => {
  jest.resetAllMocks();
  mocked.loadProcessTakeRows.mockResolvedValue([]);
  mocked.loadProcessLinkSummaries.mockResolvedValue([]);
  mocked.loadProcessResultCounts.mockResolvedValue([]);
  mocked.loadProcessSiblingCandidates.mockResolvedValue([]);
  mocked.loadLegacyTakeRows.mockResolvedValue([]);
  mocked.loadTomaAssessmentRows.mockResolvedValue([]);
  mocked.loadMatrixRows.mockResolvedValue([]);
  mocked.resolveEffectiveBandsForInstruments.mockResolvedValue(new Map());
});

describe('MasterBoardService.getTakes', () => {
  function processRow(id: string, name: string, overrides: Record<string, unknown> = {}) {
    return {
      processId: id,
      name,
      kind: 'paes_ensayo' as const,
      period: null,
      academicYearId: YEAR,
      startsOn: null,
      endsOn: null,
      createdAt: '2026-01-01T00:00:00',
      ...overrides,
    };
  }

  it('lists process takes (also without results) and the residual legacy take, newest first', async () => {
    mocked.loadProcessTakeRows.mockResolvedValue([
      processRow(PROCESS_E3, 'Ensayo PAES 3 2026'),
      processRow(PROCESS_DIA, 'DIA Monitoreo 2026', { kind: 'dia', period: 'intermedio' }),
      processRow('p-empty', 'Ensayo PAES 6 2026', { startsOn: '2026-11-02', endsOn: '2026-11-03' }),
    ]);
    mocked.loadProcessLinkSummaries.mockResolvedValue([
      {
        processId: PROCESS_E3,
        linkedAssessmentCount: 12,
        instrumentTypes: ['paes'],
        firstAdministeredAt: '2026-05-20T12:00:00',
        lastAdministeredAt: '2026-05-27T12:00:00',
      },
      {
        processId: PROCESS_DIA,
        linkedAssessmentCount: 41,
        instrumentTypes: ['dia'],
        firstAdministeredAt: '2026-08-04T12:00:00',
        lastAdministeredAt: '2026-08-04T12:00:00',
      },
    ]);
    mocked.loadProcessResultCounts.mockResolvedValue([
      { processId: PROCESS_E3, assessmentCount: 12 },
      { processId: PROCESS_DIA, assessmentCount: 41 },
    ]);
    mocked.loadLegacyTakeRows.mockResolvedValue([
      {
        academicYearId: YEAR,
        year: 2026,
        instrumentType: 'paes',
        applicationPeriod: null,
        assessmentCount: 3,
        firstAdministeredAt: '2026-03-17T12:00:00',
        lastAdministeredAt: '2026-03-17T12:00:00',
        firstCreatedAt: '2026-03-20T00:00:00',
      },
    ]);

    const service = new MasterBoardService(makeDb([YEARS_ROW]));
    const result = await service.getTakes(makeUser(), {});

    expect(result.takes.map((take) => take.key)).toEqual([
      'process:p-empty',
      `process:${PROCESS_DIA}`,
      `process:${PROCESS_E3}`,
      `legacy:${YEAR}:paes:_`,
    ]);
    const [empty, dia, e3, legacy] = result.takes;
    expect(empty).toMatchObject({
      hasResults: false,
      assessmentCount: 0,
      linkedAssessmentCount: 0,
      instrumentType: null,
      administeredFrom: '2026-11-02',
      administeredTo: '2026-11-03',
    });
    expect(dia).toMatchObject({
      label: 'DIA Monitoreo 2026',
      processId: PROCESS_DIA,
      processKind: 'dia',
      instrumentType: 'dia',
      applicationPeriod: 'intermedio',
      hasResults: true,
      assessmentCount: 41,
    });
    expect(e3).toMatchObject({ administeredFrom: '2026-05-20', administeredTo: '2026-05-27' });
    expect(legacy).toMatchObject({
      label: 'Ensayo PAES 2026 · sin proceso',
      processId: null,
      processKind: null,
      instrumentType: 'paes',
      partial: false,
    });
  });

  it('marks a process as partial when an unlinked sibling fits its invariant', async () => {
    mocked.loadProcessTakeRows.mockResolvedValue([
      processRow(PROCESS_E3, 'Ensayo PAES 3 2026'),
      processRow('p-e5', 'Ensayo PAES 5 2026'),
    ]);
    mocked.loadProcessSiblingCandidates.mockResolvedValue([
      sibling({ assessmentId: 'e3-m1-a', processId: PROCESS_E3, instrumentId: 'm1-e3' }),
      sibling({ assessmentId: 'e3-m1-b', instrumentId: 'm1-e3' }),
      sibling({ assessmentId: 'e5-m1', processId: 'p-e5', instrumentId: 'm1-e5' }),
    ]);

    const service = new MasterBoardService(makeDb([YEARS_ROW]));
    const result = await service.getTakes(makeUser(), {});
    const byKey = new Map(result.takes.map((take) => [take.key, take]));

    expect(byKey.get(`process:${PROCESS_E3}`)?.partial).toBe(true);
    expect(byKey.get('process:p-e5')?.partial).toBe(false);
  });

  it('does not mark as partial a sibling that would put a second instrument in the same grade and test', async () => {
    mocked.loadProcessTakeRows.mockResolvedValue([processRow(PROCESS_E3, 'Ensayo PAES 3 2026')]);
    mocked.loadProcessSiblingCandidates.mockResolvedValue([
      sibling({ assessmentId: 'e3-m1', processId: PROCESS_E3, instrumentId: 'm1-e3' }),
      sibling({ assessmentId: 'e4-m1', instrumentId: 'm1-e4' }),
      sibling({ assessmentId: 'dia-x', instrumentType: 'dia', instrumentId: 'dia-1' }),
    ]);

    const service = new MasterBoardService(makeDb([YEARS_ROW]));
    const result = await service.getTakes(makeUser(), {});

    expect(result.takes[0]?.partial).toBe(false);
  });
});

describe('MasterBoardService.getMatrix — resolución de la toma', () => {
  it('resolves a process take by processId', async () => {
    mocked.loadTomaAssessmentRows.mockResolvedValue([
      tomaRow({ assessmentId: 'a1', activeProcessId: PROCESS_E3, instrumentType: 'paes' }),
      tomaRow({ assessmentId: 'a2', activeProcessId: PROCESS_E3, instrumentType: 'paes' }),
    ]);
    mocked.loadMatrixRows.mockResolvedValue([matrixRow({ assessmentIds: ['a1', 'a2'] })]);
    const db = makeDb([
      [
        {
          id: PROCESS_E3,
          name: 'Ensayo PAES 3 2026',
          kind: 'paes_ensayo',
          period: null,
          academicYearId: YEAR,
        },
      ],
      [],
    ]);

    const matrix = await new MasterBoardService(db).getMatrix(makeUser(), {
      processId: PROCESS_E3,
    });

    expect(matrix.take).toMatchObject({
      label: 'Ensayo PAES 3 2026',
      processId: PROCESS_E3,
      processKind: 'paes_ensayo',
      academicYearId: YEAR,
      instrumentType: 'paes',
    });
    expect(matrix.take.assessmentIds.sort()).toEqual(['a1', 'a2']);
    expect(matrix.redirectProcessId).toBeNull();
    expect(mocked.loadMatrixRows).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assessmentIds: ['a1', 'a2'], scopedClassGroupIds: null }),
    );
  });

  it('rejects an unknown or deleted process with 404', async () => {
    const db = makeDb([[]]);
    await expect(
      new MasterBoardService(db).getMatrix(makeUser(), { processId: PROCESS_E3 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('legacy take only keeps the assessments without an active process', async () => {
    mocked.loadTomaAssessmentRows.mockResolvedValue([
      tomaRow({ assessmentId: 'linked', activeProcessId: PROCESS_E3, instrumentType: 'paes' }),
      tomaRow({ assessmentId: 'residual', instrumentId: 'i2', instrumentType: 'paes' }),
    ]);
    mocked.loadMatrixRows.mockResolvedValue([matrixRow({ assessmentIds: ['residual'] })]);
    const db = makeDb([[{ year: 2026 }], []]);

    const matrix = await new MasterBoardService(db).getMatrix(makeUser(), {
      academicYearId: YEAR,
      instrumentType: 'paes',
    });

    expect(matrix.take.assessmentIds).toEqual(['residual']);
    expect(matrix.take.label).toBe('Ensayo PAES 2026 · sin proceso');
    expect(matrix.redirectProcessId).toBeNull();
    expect(mocked.loadMatrixRows).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ assessmentIds: ['residual'] }),
    );
  });

  it('a legacy URL whose assessments are all in one process returns redirectProcessId', async () => {
    mocked.loadTomaAssessmentRows.mockResolvedValue([
      tomaRow({ assessmentId: 'a1', activeProcessId: PROCESS_DIA }),
      tomaRow({ assessmentId: 'a2', activeProcessId: PROCESS_DIA }),
    ]);
    const db = makeDb([[{ year: 2026 }]]);

    const matrix = await new MasterBoardService(db).getMatrix(makeUser(), {
      academicYearId: YEAR,
      instrumentType: 'dia',
      applicationPeriod: 'intermedio',
    });

    expect(matrix.redirectProcessId).toBe(PROCESS_DIA);
    expect(matrix.take.assessmentIds).toEqual([]);
    expect(matrix.grades).toEqual([]);
    expect(mocked.loadMatrixRows).not.toHaveBeenCalled();
  });

  it('does not redirect when the legacy assessments are split across processes', async () => {
    mocked.loadTomaAssessmentRows.mockResolvedValue([
      tomaRow({ assessmentId: 'a1', activeProcessId: PROCESS_DIA }),
      tomaRow({ assessmentId: 'a2', activeProcessId: PROCESS_E3 }),
    ]);
    const db = makeDb([[{ year: 2026 }]]);

    const matrix = await new MasterBoardService(db).getMatrix(makeUser(), {
      academicYearId: YEAR,
      instrumentType: 'dia',
    });

    expect(matrix.redirectProcessId).toBeNull();
  });
});

describe('masterBoardMatrixQuerySchema', () => {
  it('rejects processId combined with another take parameter with 400', () => {
    for (const extra of [
      { academicYearId: YEAR },
      { instrumentType: 'paes' },
      { applicationPeriod: 'intermedio' },
      { assessmentId: PROCESS_DIA },
    ]) {
      expect(() =>
        parseDtoOrBadRequest(masterBoardMatrixQuerySchema, { processId: PROCESS_E3, ...extra }),
      ).toThrow(BadRequestException);
    }
  });

  it('rejects unknown keys instead of ignoring the filter', () => {
    expect(() =>
      parseDtoOrBadRequest(masterBoardMatrixQuerySchema, { procesId: PROCESS_E3 }),
    ).toThrow(BadRequestException);
  });

  it('accepts processId with grade, subject and metric filters', () => {
    expect(
      parseDtoOrBadRequest(masterBoardMatrixQuerySchema, {
        processId: PROCESS_E3,
        gradeId: YEAR,
        metric: 'achievement',
      }),
    ).toMatchObject({ processId: PROCESS_E3, gradeId: [YEAR] });
  });
});

describe('MasterBoardService.getMatrix — columnas y celdas', () => {
  async function matrixFor(rows: MatrixRow[], bands: Record<string, PerformanceBandInput[]> = {}) {
    const instrumentIds = new Set(rows.flatMap((row) => row.instrumentIds));
    mocked.loadTomaAssessmentRows.mockResolvedValue(
      [...instrumentIds].map((instrumentId, index) =>
        tomaRow({
          assessmentId: `a${index}`,
          instrumentId,
          activeProcessId: PROCESS_E3,
          instrumentType: 'paes',
        }),
      ),
    );
    mocked.loadMatrixRows.mockResolvedValue(rows);
    mocked.resolveEffectiveBandsForInstruments.mockResolvedValue(bandsFor(bands));
    const db = makeDb([
      [
        {
          id: PROCESS_E3,
          name: 'Ensayo PAES 3 2026',
          kind: 'paes_ensayo',
          period: null,
          academicYearId: YEAR,
        },
      ],
      [],
    ]);
    return new MasterBoardService(db).getMatrix(makeUser(), { processId: PROCESS_E3 });
  }

  it('puts M1 and M2 in separate columns under Matemática', async () => {
    const matrix = await matrixFor([
      matrixRow({
        trackId: 't-m1',
        trackName: 'Competencia Matemática 1',
        trackShortName: 'M1',
        trackOrder: 1,
        instrumentIds: ['m1'],
        scoreSum: '60',
      }),
      matrixRow({
        trackId: 't-m2',
        trackName: 'Competencia Matemática 2',
        trackShortName: 'M2',
        trackOrder: 2,
        instrumentIds: ['m2'],
        scoreSum: '30',
      }),
    ]);

    expect(matrix.subjects).toHaveLength(1);
    expect(matrix.subjects[0]?.tests).toEqual([
      expect.objectContaining({ testKey: 'track:t-m1', shortName: 'M1', source: 'instrument' }),
      expect.objectContaining({ testKey: 'track:t-m2', shortName: 'M2', source: 'instrument' }),
    ]);
    const [m1, m2] = matrix.grades[0]!.cells;
    expect(m1).toMatchObject({ testKey: 'track:t-m1', subjectId: 's-math', mixed: false });
    expect(m1?.metrics[0]?.value).toBeCloseTo(60);
    expect(m2?.metrics[0]?.value).toBeCloseTo(30);
    expect(matrix.grades[0]!.courses[0]!.cells.map((cell) => cell.testKey)).toEqual([
      'track:t-m1',
      'track:t-m2',
    ]);
  });

  it('marks a cell with two instruments without a track as mixed and does not color it', async () => {
    const matrix = await matrixFor(
      [
        matrixRow({ classGroupId: 'cg-a', instrumentIds: ['i1'], assessmentIds: ['a1'] }),
        matrixRow({
          classGroupId: 'cg-b',
          classGroupName: '4°B',
          instrumentIds: ['i2'],
          assessmentIds: ['a2'],
        }),
      ],
      { i1: DIA_BANDS, i2: DIA_BANDS },
    );

    const gradeCell = matrix.grades[0]!.cells[0]!;
    expect(gradeCell).toMatchObject({ mixed: true, hasLevels: false });
    expect(gradeCell.metrics[0]?.level).toBeNull();
    expect(gradeCell.comparability.kind).not.toBe('single_instrument');
    expect(matrix.subjects[0]?.tests[0]).toMatchObject({ source: 'subject', mixed: true });
    const [courseA] = matrix.grades[0]!.courses;
    expect(courseA?.cells[0]).toMatchObject({ mixed: false, hasLevels: true });
  });

  it('a section column (elective instrument) has no levels even with bands', async () => {
    const matrix = await matrixFor(
      [
        matrixRow({
          subjectId: 's-sci',
          subjectName: 'Ciencias',
          trackId: 't-bio',
          trackName: 'Biología',
          trackShortName: 'Bio',
          trackOrder: 2,
          fromElectiveInstrument: true,
          instrumentIds: ['cie'],
        }),
      ],
      { cie: DIA_BANDS },
    );

    expect(matrix.subjects[0]?.tests[0]).toMatchObject({ source: 'section', hasLevels: false });
    expect(matrix.grades[0]!.cells[0]).toMatchObject({ hasLevels: false, mixed: false });
    expect(matrix.grades[0]!.cells[0]!.metrics[0]?.level).toBeNull();
  });

  it('colors each cell with the bands of its own instrument', async () => {
    const matrix = await matrixFor(
      [
        matrixRow({ instrumentIds: ['i4'], scoreSum: '50', maxSum: '100' }),
        matrixRow({
          gradeId: 'g5',
          gradeName: '5° básico',
          gradeOrder: 5,
          classGroupId: 'cg-5a',
          classGroupName: '5°A',
          instrumentIds: ['i5'],
          scoreSum: '80',
          maxSum: '100',
        }),
      ],
      { i4: DIA_BANDS },
    );

    const [fourth, fifth] = matrix.grades;
    expect(fourth?.cells[0]).toMatchObject({ hasLevels: true });
    expect(fourth?.cells[0]?.metrics[0]?.level).toMatchObject({
      key: 'dia_nivel_2',
      label: 'Nivel II',
      color: 'adequate',
    });
    expect(fourth?.cells[0]?.comparability.kind).toBe('single_assessment');
    expect(fifth?.cells[0]).toMatchObject({ hasLevels: false });
    expect(fifth?.cells[0]?.metrics[0]?.level).toBeNull();
    expect(matrix.subjects[0]?.tests[0]?.hasLevels).toBe(true);
  });
});
