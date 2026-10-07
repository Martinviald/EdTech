import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  assessmentResults,
  assessments,
  classGroups,
  instruments,
  measurementProcesses,
  resolveEffectiveBandsForInstruments,
  studentEnrollments,
  students,
  type Database,
} from '@soe/db';
import {
  officialEstablishmentReportQuerySchema,
  type ExpectedScope,
  type OfficialEstablishmentReportResponse,
  type PerformanceBandInput,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { parseDtoOrBadRequest } from '../common/helpers/parse-dto.helper';
import { EstablishmentReportService } from './establishment-report.service';
import type { ReportSupportService } from './report-support.service';

jest.mock('drizzle-orm', () => ({
  ...jest.requireActual('drizzle-orm'),
  eq: (col: unknown, val: unknown) => ({ pred: 'eq', col, val }),
  isNull: (col: unknown) => ({ pred: 'isNull', col }),
  inArray: (col: unknown, vals: unknown) => ({ pred: 'in', col, vals }),
  and: (...conds: unknown[]) => ({ pred: 'and', conds }),
}));

jest.mock('@soe/db', () => ({
  ...jest.requireActual('@soe/db'),
  withOrgContext: (db: unknown, _orgId: string, fn: (tx: unknown) => unknown) => fn(db),
  resolveEffectiveBandsForInstruments: jest.fn(),
}));

const ORG = 'org-1';
const OTHER_ORG = 'org-2';
const PROCESS = 'proc-1';
const OTHER_PROCESS = 'proc-2';

const DIA_BANDS: PerformanceBandInput[] = [
  { id: 'b1', key: 'dia_nivel_1', label: 'Nivel I', order: 0, minThreshold: 0, maxThreshold: 0.3 },
  {
    id: 'b2',
    key: 'dia_nivel_2',
    label: 'Nivel II',
    order: 1,
    minThreshold: 0.3,
    maxThreshold: 0.75,
  },
  {
    id: 'b3',
    key: 'dia_nivel_3',
    label: 'Nivel III',
    order: 2,
    minThreshold: 0.75,
    maxThreshold: 1,
  },
];

const OTHER_BANDS: PerformanceBandInput[] = [
  { id: 'o1', key: 'low', label: 'Bajo', order: 0, minThreshold: 0, maxThreshold: 0.5 },
  { id: 'o2', key: 'high', label: 'Alto', order: 1, minThreshold: 0.5, maxThreshold: 1 },
];

const LEGACY_LEVELS = ['insufficient', 'elementary', 'adequate', 'advanced'];

type Row = Record<string, unknown>;

type Predicate =
  | { pred: 'eq'; col: unknown; val: unknown }
  | { pred: 'isNull'; col: unknown }
  | { pred: 'in'; col: unknown; vals: unknown[] }
  | { pred: 'and'; conds: Predicate[] };

const FIELD_OF = new Map<unknown, string>([
  [measurementProcesses.id, 'id'],
  [measurementProcesses.orgId, 'orgId'],
  [measurementProcesses.deletedAt, 'deletedAt'],
  [assessments.orgId, 'orgId'],
  [assessments.processId, 'processId'],
  [instruments.deletedAt, 'instrumentDeletedAt'],
  [instruments.id, 'id'],
  [assessmentResults.assessmentId, 'assessmentId'],
  [students.orgId, 'studentOrgId'],
  [students.deletedAt, 'studentDeletedAt'],
  [classGroups.orgId, 'orgId'],
  [classGroups.id, 'id'],
  [studentEnrollments.classGroupId, 'classGroupId'],
  [studentEnrollments.status, 'status'],
]);

function matches(row: Row, predicate: Predicate | undefined): boolean {
  if (!predicate) return true;
  if (predicate.pred === 'and') return predicate.conds.every((c) => matches(row, c));
  const field = FIELD_OF.get(predicate.col);
  if (!field) return true;
  if (predicate.pred === 'eq') return row[field] === predicate.val;
  if (predicate.pred === 'isNull') return row[field] === null || row[field] === undefined;
  return predicate.vals.includes(row[field]);
}

type Store = {
  processes: Row[];
  assignments: Row[];
  results: Row[];
  classGroups: Row[];
  enrollments: Row[];
  instruments: Row[];
};

function makeDb(store: Store): Database {
  const tables = new Map<unknown, Row[]>([
    [measurementProcesses, store.processes],
    [assessments, store.assignments],
    [assessmentResults, store.results],
    [classGroups, store.classGroups],
    [studentEnrollments, store.enrollments],
    [instruments, store.instruments],
  ]);
  const db = {
    select: () => {
      let rows: Row[] = [];
      let predicate: Predicate | undefined;
      const chain: Record<string, unknown> = {
        from: (table: unknown) => {
          rows = tables.get(table) ?? [];
          return chain;
        },
        innerJoin: () => chain,
        leftJoin: () => chain,
        groupBy: () => chain,
        limit: () => chain,
        where: (p: Predicate) => {
          predicate = p;
          return chain;
        },
        then: (resolve: (value: Row[]) => unknown) =>
          Promise.resolve(rows.filter((r) => matches(r, predicate))).then(resolve),
      };
      return chain;
    },
  };
  return db as unknown as Database;
}

function makeSupport(): ReportSupportService {
  return {
    requireOrgId: (user: JwtPayload) => user.orgId,
    loadOrgMeta: async () => ({
      orgId: ORG,
      orgName: 'Colegio de prueba',
      rbd: null,
      commune: null,
      region: null,
    }),
    loadDirectorName: async () => null,
    resolveVariant: () => 'achievement_levels',
  } as unknown as ReportSupportService;
}

function user(orgId = ORG): JwtPayload {
  return { userId: 'u-1', orgId, roles: ['school_admin'] } as unknown as JwtPayload;
}

function processRow(overrides: Row = {}): Row {
  return {
    id: PROCESS,
    orgId: ORG,
    deletedAt: null,
    name: 'DIA Intermedio 2026',
    academicYearId: 'ay-2026',
    academicYear: 2026,
    period: 'intermedio',
    expectedScope: {},
    ...overrides,
  };
}

function assignment(overrides: Row = {}): Row {
  return {
    orgId: ORG,
    processId: PROCESS,
    instrumentDeletedAt: null,
    assessmentId: 'a-lang-6',
    assessmentName: 'Lectura 6° A',
    instrumentId: 'lectura-6',
    subjectId: 'lang',
    subjectName: 'Lenguaje y Comunicación',
    classGroupId: 'cg-6a',
    gradeId: 'g6',
    gradeName: '6° Básico',
    gradeOrder: 6,
    ...overrides,
  };
}

function result(index: number, percentage: number | null, overrides: Row = {}): Row {
  return {
    studentId: `s${index}`,
    assessmentId: 'a-lang-6',
    classGroupId: 'cg-6a',
    gender: null,
    percentage,
    metricType: 'percentage',
    performanceBandId: null,
    studentOrgId: ORG,
    studentDeletedAt: null,
    ...overrides,
  };
}

function enrollment(classGroupId: string, total: number): Row {
  return { classGroupId, total, status: 'active', studentOrgId: ORG, studentDeletedAt: null };
}

function emptyStore(overrides: Partial<Store> = {}): Store {
  return {
    processes: [processRow()],
    assignments: [],
    results: [],
    classGroups: [],
    enrollments: [],
    instruments: [],
    ...overrides,
  };
}

function mockBands(bandsByInstrument: Record<string, PerformanceBandInput[]>): void {
  jest.mocked(resolveEffectiveBandsForInstruments).mockImplementation(async (_tx, ids) => {
    const resolved = new Map();
    for (const id of ids) {
      const bands = bandsByInstrument[id] ?? [];
      resolved.set(id, { bands, source: bands.length > 0 ? 'own' : 'none' });
    }
    return resolved;
  });
}

function run(store: Store, orgId = ORG): Promise<OfficialEstablishmentReportResponse> {
  const service = new EstablishmentReportService(makeDb(store), makeSupport());
  return service.getEstablishmentReport(user(orgId), { processId: PROCESS });
}

const LECTURA_6_PERCENTAGES = [
  50, 53.33, 53.33, 63.33, 66.67, 66.67, 70, 73.33, 73.33, 76.67, 76.67, 76.67, 80, 83.33, 86.67,
  90, 93.33, 93.33,
];

beforeEach(() => {
  mockBands({ 'lectura-6': DIA_BANDS });
});

describe('EstablishmentReportService — alcance por proceso', () => {
  it('toma año, momento y nombre del proceso', async () => {
    const report = await run(emptyStore({ assignments: [assignment()] }));

    expect(report.meta).toMatchObject({
      processId: PROCESS,
      processName: 'DIA Intermedio 2026',
      academicYearId: 'ay-2026',
      academicYear: 2026,
      period: 'intermedio',
    });
  });

  it('no incluye evaluaciones de otro proceso', async () => {
    const report = await run(
      emptyStore({
        assignments: [
          assignment(),
          assignment({
            processId: OTHER_PROCESS,
            assessmentId: 'a-otro',
            instrumentId: 'lectura-6-cierre',
          }),
          assignment({
            processId: OTHER_PROCESS,
            assessmentId: 'a-mate',
            subjectId: 'math',
            subjectName: 'Matemática',
          }),
        ],
        results: [result(1, 60), result(2, 80, { assessmentId: 'a-otro' })],
      }),
    );

    expect(report.subjects).toHaveLength(1);
    const [column] = report.subjects[0]!.grades;
    expect(column).toMatchObject({
      assessmentIds: ['a-lang-6'],
      multipleInstruments: false,
      instrumentId: 'lectura-6',
    });
    expect(column!.coverage.evaluated).toBe(1);
  });

  it('lanza NotFound si el proceso no existe, es de otra org o está borrado', async () => {
    await expect(run(emptyStore({ processes: [] }))).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      run(emptyStore({ processes: [processRow({ orgId: OTHER_ORG })] })),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      run(emptyStore({ processes: [processRow({ deletedAt: new Date() })] })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('EstablishmentReportService — un instrumento por grado × asignatura', () => {
  it('marca multipleInstruments sin números cuando la celda tiene dos instrumentos', async () => {
    const report = await run(
      emptyStore({
        assignments: [
          assignment(),
          assignment({
            assessmentId: 'a-lang-6-bis',
            assessmentName: 'Lectura 6° recuperativa',
            instrumentId: 'lectura-6-bis',
          }),
          assignment({
            assessmentId: 'a-lang-7',
            instrumentId: 'lectura-6',
            classGroupId: 'cg-7a',
            gradeId: 'g7',
            gradeName: '7° Básico',
            gradeOrder: 7,
          }),
        ],
        results: [
          result(1, 60, { gender: 'F' }),
          result(2, 90, { gender: 'M', assessmentId: 'a-lang-6-bis' }),
          result(3, 80, { gender: 'F', assessmentId: 'a-lang-7', classGroupId: 'cg-7a' }),
        ],
      }),
    );

    const [section] = report.subjects;
    const sixth = section!.grades.find((g) => g.gradeId === 'g6');
    expect(sixth).toMatchObject({
      multipleInstruments: true,
      instrumentId: null,
      bands: null,
      bandsMissing: false,
      assessmentIds: ['a-lang-6', 'a-lang-6-bis'],
      assessments: [
        { id: 'a-lang-6', name: 'Lectura 6° A' },
        { id: 'a-lang-6-bis', name: 'Lectura 6° recuperativa' },
      ],
      coverage: { evaluated: 2 },
    });
    expect(section!.bandDistribution.some((c) => c.gradeId === 'g6')).toBe(false);
    expect(section!.sexComparison.some((r) => r.gradeId === 'g6')).toBe(false);
    expect(section!.counts.some((r) => r.gradeId === 'g6')).toBe(false);
    expect(section!.counts.map((r) => r.gradeId)).toEqual(['g7']);
  });

  it('agrega en una columna las evaluaciones por curso del mismo instrumento', async () => {
    const report = await run(
      emptyStore({
        assignments: [
          assignment(),
          assignment({
            assessmentId: 'a-lang-6b',
            assessmentName: 'Lectura 6° B',
            classGroupId: 'cg-6b',
          }),
        ],
        results: [
          result(1, 60, { gender: 'F' }),
          result(2, 90, { gender: 'M', assessmentId: 'a-lang-6b', classGroupId: 'cg-6b' }),
        ],
      }),
    );

    const [section] = report.subjects;
    expect(section!.grades).toHaveLength(1);
    expect(section!.grades[0]).toMatchObject({
      multipleInstruments: false,
      instrumentId: 'lectura-6',
      assessmentIds: ['a-lang-6', 'a-lang-6b'],
      coverage: { evaluated: 2 },
    });
    expect(report.bandsAvailable).toBe(true);
    const total = section!.bandDistribution.find((c) => c.gradeId === 'g6')?.total;
    expect(total).toBe(2);
    expect(section!.counts[0]).toMatchObject({ female: 1, male: 1, total: 2 });
  });

  it('cuenta una sola vez a un estudiante matriculado en dos cursos del mismo grado', async () => {
    const report = await run(
      emptyStore({
        assignments: [assignment(), assignment({ classGroupId: 'cg-6b' })],
        results: [result(1, 60), result(1, 60, { classGroupId: 'cg-6b' })],
      }),
    );

    expect(report.subjects[0]!.counts[0]!.total).toBe(1);
    expect(report.subjects[0]!.grades[0]!.coverage.evaluated).toBe(1);
  });
});

describe('EstablishmentReportService — niveles por bandas del instrumento', () => {
  it('clasifica por los cortes del instrumento', async () => {
    const report = await run(
      emptyStore({
        assignments: [assignment()],
        results: LECTURA_6_PERCENTAGES.map((p, i) => result(i, p)),
      }),
    );

    const [section] = report.subjects;
    expect(report.bandsAvailable).toBe(true);
    expect(section!.bands?.map((b) => b.key)).toEqual([
      'dia_nivel_1',
      'dia_nivel_2',
      'dia_nivel_3',
    ]);
    const byBand = new Map(section!.bandDistribution.map((c) => [c.bandKey, c]));
    expect(byBand.get('dia_nivel_1')).toMatchObject({ count: 0, total: 18, percentage: 0 });
    expect(byBand.get('dia_nivel_2')).toMatchObject({ count: 9, total: 18, percentage: 50 });
    expect(byBand.get('dia_nivel_3')).toMatchObject({ count: 9, total: 18, percentage: 50 });
  });

  it('usa la banda guardada en filas band-only sin porcentaje', async () => {
    const report = await run(
      emptyStore({
        assignments: [assignment()],
        results: [
          result(1, null, { metricType: 'band', performanceBandId: 'b1' }),
          result(2, null, { metricType: 'band', performanceBandId: 'b3' }),
        ],
      }),
    );

    const byBand = new Map(report.subjects[0]!.bandDistribution.map((c) => [c.bandKey, c.count]));
    expect(byBand.get('dia_nivel_1')).toBe(1);
    expect(byBand.get('dia_nivel_3')).toBe(1);
  });

  it('marca bandsMissing y nunca usa los niveles heredados si el instrumento no tiene bandas', async () => {
    mockBands({});
    const report = await run(
      emptyStore({
        assignments: [assignment()],
        results: [result(1, 40, { gender: 'F' }), result(2, 95, { gender: 'M' })],
      }),
    );

    const [section] = report.subjects;
    expect(report.bandsAvailable).toBe(false);
    expect(section!.grades[0]).toMatchObject({ bandsMissing: true, bands: null });
    expect(section!.bands).toBeNull();
    expect(section!.bandDistribution).toEqual([]);
    expect(section!.counts[0]!.total).toBe(2);
    const serialized = JSON.stringify(report);
    for (const level of LEGACY_LEVELS) expect(serialized).not.toContain(`"${level}"`);
    expect(section).not.toHaveProperty('levelDistribution');
    expect(section).not.toHaveProperty('levels');
  });

  it('deja bands de la sección en null si las columnas traen sets distintos', async () => {
    mockBands({ 'lectura-6': DIA_BANDS, 'otro-7': OTHER_BANDS });
    const report = await run(
      emptyStore({
        assignments: [
          assignment(),
          assignment({
            assessmentId: 'a-otro-7',
            instrumentId: 'otro-7',
            classGroupId: 'cg-7a',
            gradeId: 'g7',
            gradeName: '7° Básico',
            gradeOrder: 7,
          }),
        ],
        results: [
          result(1, 60),
          result(2, 90, { assessmentId: 'a-otro-7', classGroupId: 'cg-7a' }),
        ],
      }),
    );

    const [section] = report.subjects;
    expect(section!.bands).toBeNull();
    expect(section!.grades.map((g) => g.bands?.map((b) => b.key))).toEqual([
      ['dia_nivel_1', 'dia_nivel_2', 'dia_nivel_3'],
      ['low', 'high'],
    ]);
    expect(section!.bandDistribution.map((c) => `${c.gradeId}:${c.bandKey}:${c.count}`)).toEqual([
      'g6:dia_nivel_1:0',
      'g6:dia_nivel_2:1',
      'g6:dia_nivel_3:0',
      'g7:low:0',
      'g7:high:1',
    ]);
  });
});

describe('EstablishmentReportService — cobertura', () => {
  it('usa la matrícula activa de los cursos asignados si el proceso no declara alcance', async () => {
    const report = await run(
      emptyStore({
        assignments: [assignment(), assignment({ classGroupId: 'cg-6b' })],
        results: [result(1, 60), result(2, 70, { classGroupId: 'cg-6b' })],
        classGroups: [
          { id: 'cg-6a', gradeId: 'g6', orgId: ORG },
          { id: 'cg-6b', gradeId: 'g6', orgId: ORG },
        ],
        enrollments: [enrollment('cg-6a', 30), enrollment('cg-6b', 28)],
      }),
    );

    expect(report.subjects[0]!.grades[0]!.coverage).toEqual({ evaluated: 2, expected: 58 });
  });

  it('deriva los esperados del alcance declarado del proceso, respetando las exclusiones', async () => {
    const scope: ExpectedScope = {
      classGroupIds: ['cg-6a', 'cg-6b', 'cg-6c'],
      subjectIds: ['lang'],
      excludedCells: [{ classGroupId: 'cg-6c', subjectId: 'lang' }],
    };
    const report = await run(
      emptyStore({
        processes: [processRow({ expectedScope: scope })],
        assignments: [assignment()],
        results: [result(1, 60)],
        classGroups: [
          { id: 'cg-6a', gradeId: 'g6', orgId: ORG },
          { id: 'cg-6b', gradeId: 'g6', orgId: ORG },
          { id: 'cg-6c', gradeId: 'g6', orgId: ORG },
        ],
        enrollments: [enrollment('cg-6a', 30), enrollment('cg-6b', 28), enrollment('cg-6c', 25)],
      }),
    );

    expect(report.subjects[0]!.grades[0]!.coverage).toEqual({ evaluated: 1, expected: 58 });
  });

  it('deja expected en null si no hay matrícula conocida', async () => {
    const report = await run(emptyStore({ assignments: [assignment()], results: [result(1, 60)] }));

    expect(report.subjects[0]!.grades[0]!.coverage).toEqual({ evaluated: 1, expected: null });
  });
});

describe('officialEstablishmentReportQuerySchema', () => {
  it('rechaza las claves del filtro anterior por año y momento', () => {
    const processId = '7e570000-0000-4000-8000-000000000001';
    expect(parseDtoOrBadRequest(officialEstablishmentReportQuerySchema, { processId })).toEqual({
      processId,
    });
    expect(() =>
      parseDtoOrBadRequest(officialEstablishmentReportQuerySchema, {
        processId,
        academicYearId: processId,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      parseDtoOrBadRequest(officialEstablishmentReportQuerySchema, {
        processId,
        period: 'intermedio',
      }),
    ).toThrow(BadRequestException);
    expect(() => parseDtoOrBadRequest(officialEstablishmentReportQuerySchema, {})).toThrow(
      BadRequestException,
    );
  });
});
