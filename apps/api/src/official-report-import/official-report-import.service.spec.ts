import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { getTableName } from 'drizzle-orm';
import type { OfficialReportImportFile } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import type { Database } from '../database/database.types';
import { OfficialReportImportService } from './official-report-import.service';
import { OfficialReportPreviewStore } from './lib/preview-store';
import {
  DIA_BANDS,
  INSTRUMENT_ITEMS,
  NODE_LOCALIZAR,
  NODE_REFLEXIONAR,
  TABLA_1,
  buildReport,
} from './lib/fixtures/informe-3a-cierre-2025';

/**
 * Tests del OfficialReportImportService con mocks del Database (sin PostgreSQL).
 * Se enfocan en la orquestación: contrato, multi-tenancy, token de un solo uso,
 * la regla de "el humano aprueba" y el 409 de §9.3. La aritmética del informe se
 * prueba en `lib/*.spec.ts` contra el informe real.
 */

const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ORG_B = 'bbbbbbbb-0000-0000-0000-000000000001';
const INSTRUMENT_ID = 'cccccccc-0000-0000-0000-000000000001';
const CLASS_GROUP_ID = 'dddddddd-0000-0000-0000-000000000001';
const ASSESSMENT_ID = 'eeeeeeee-0000-0000-0000-000000000001';
const USER_ID = 'ffffffff-0000-0000-0000-000000000001';
const JOB_ID = '99990000-0000-0000-0000-000000000001';
const STUDENT_1 = '11110000-0000-0000-0000-000000000001';
const STUDENT_2 = '11110000-0000-0000-0000-000000000002';
const OTHER_STUDENT = '11110000-0000-0000-0000-000000000009';

function makeJwt(orgId: string | null = ORG_A): JwtPayload {
  return {
    userId: USER_ID,
    orgId,
    email: 'utp@colegio.cl',
    name: 'Coordinadora',
    isPlatformAdmin: false,
    roles: ['eval_coordinator'],
    activeRole: 'eval_coordinator',
    role: 'eval_coordinator',
  };
}

type Captured = {
  itemStats: unknown[][];
  skillStats: unknown[][];
  levelStats: unknown[][];
  assessmentResults: unknown[][];
  assessments: unknown[][];
  courseAssignments: unknown[][];
  importJobs: unknown[][];
};

function emptyCaptured(): Captured {
  return {
    itemStats: [],
    skillStats: [],
    levelStats: [],
    assessmentResults: [],
    assessments: [],
    courseAssignments: [],
    importJobs: [],
  };
}

function buildMockDb(
  plan: {
    instrumentFound?: boolean;
    classGroupFound?: boolean;
    itemRows?: Array<{ id: string; position: number; scoringConfig: unknown }>;
    assessmentRow?: { id: string; orgId: string; dataGranularity: string } | null;
    roster?: Array<{ id: string; firstName: string; lastName: string }>;
  } = {},
  captured: Captured = emptyCaptured(),
): Database {
  const detect = (table: unknown): string => {
    try {
      return getTableName(table as Parameters<typeof getTableName>[0]);
    } catch {
      return String(table);
    }
  };

  const rowsFor = (name: string): unknown[] => {
    switch (name) {
      case 'instruments':
        return plan.instrumentFound === false
          ? []
          : [{ id: INSTRUMENT_ID, name: 'DIA Lectura 3° Cierre 2025' }];
      case 'class_groups':
        return plan.classGroupFound === false ? [] : [{ id: CLASS_GROUP_ID, name: '3 A' }];
      case 'items':
        return (
          plan.itemRows ??
          INSTRUMENT_ITEMS.map((i) => ({
            id: i.id,
            position: i.position,
            scoringConfig: { points: i.points },
          }))
        );
      case 'item_taxonomy_tags':
        return INSTRUMENT_ITEMS.filter((i) => i.position !== 1).map((i) => ({
          itemId: i.id,
          nodeId: i.position === 14 || i.position === 19 ? NODE_REFLEXIONAR : NODE_LOCALIZAR,
        }));
      case 'taxonomy_nodes':
        return [
          { id: NODE_LOCALIZAR, name: 'Localizar' },
          { id: NODE_REFLEXIONAR, name: 'Reflexionar' },
        ];
      case 'students':
        return (
          plan.roster ?? [
            { id: STUDENT_1, firstName: 'Camila Andrea', lastName: 'Arredondo Saballa' },
            { id: STUDENT_2, firstName: 'Benjamín', lastName: 'Muñoz Rojas' },
          ]
        );
      case 'performance_bands':
        return DIA_BANDS.map((b) => ({
          id: b.id,
          orgId: null,
          key: b.key,
          label: b.label,
          order: b.order,
          minThreshold: String(b.minThreshold),
          maxThreshold: String(b.maxThreshold),
          color: b.color,
        }));
      case 'assessments':
        return plan.assessmentRow ? [plan.assessmentRow] : [];
      default:
        return [];
    }
  };

  const terminal = (name: string) => ({
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rowsFor(name)).then(resolve, reject),
    orderBy: () => Promise.resolve(rowsFor(name)),
  });

  const selectChain = (table: unknown) => {
    const name = detect(table);
    const chain = {
      innerJoin: () => chain,
      where: () => terminal(name),
      orderBy: () => Promise.resolve(rowsFor(name)),
    };
    return chain;
  };

  const insertFor = (table: unknown) => {
    const name = detect(table);
    return {
      values: (values: unknown) => {
        const arr = Array.isArray(values) ? values : [values];
        if (name === 'assessment_item_stats') captured.itemStats.push(arr);
        if (name === 'assessment_skill_stats') captured.skillStats.push(arr);
        if (name === 'assessment_level_stats') captured.levelStats.push(arr);
        if (name === 'assessment_results') captured.assessmentResults.push(arr);
        if (name === 'assessments') captured.assessments.push(arr);
        if (name === 'assessment_course_assignments') captured.courseAssignments.push(arr);
        if (name === 'import_jobs') captured.importJobs.push(arr);
        const done = {
          then: (resolve: (v: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
          returning: () =>
            Promise.resolve([{ id: name === 'import_jobs' ? JOB_ID : ASSESSMENT_ID }]),
          onConflictDoNothing: () => Promise.resolve(undefined),
          onConflictDoUpdate: () => Promise.resolve(undefined),
        };
        return done;
      },
    };
  };

  const api = {
    execute: async () => [],
    select: () => ({ from: (table: unknown) => selectChain(table) }),
    insert: (table: unknown) => insertFor(table),
    delete: () => ({ where: () => Promise.resolve(undefined) }),
  };

  return {
    ...api,
    transaction: async (cb: (tx: Database) => Promise<unknown>) => cb(api as unknown as Database),
  } as unknown as Database;
}

function toBuffer(file: unknown): Buffer {
  return Buffer.from(JSON.stringify(file), 'utf-8');
}

async function uploadReport(
  service: OfficialReportImportService,
  file: OfficialReportImportFile = buildReport(),
  metadata: Record<string, string> = {},
) {
  return service.upload(
    makeJwt(),
    { buffer: toBuffer(file), originalname: 'informe.json' },
    {
      instrumentId: INSTRUMENT_ID,
      classGroupId: CLASS_GROUP_ID,
      ...metadata,
    },
  );
}

describe('OfficialReportImportService — upload', () => {
  let store: OfficialReportPreviewStore;

  beforeEach(() => {
    store = new OfficialReportPreviewStore();
  });

  it('valida el contrato y devuelve un previewToken sin persistir nada', async () => {
    const captured = emptyCaptured();
    const service = new OfficialReportImportService(buildMockDb({}, captured), store);

    const out = await uploadReport(service);

    expect(out.previewToken).toHaveLength(36);
    expect(out.totalItems).toBe(TABLA_1.length);
    expect(out.totalStudents).toBe(0);
    expect(captured.itemStats).toEqual([]);
    expect(captured.assessments).toEqual([]);
  });

  it('rechaza un archivo que no es JSON', async () => {
    const service = new OfficialReportImportService(buildMockDb(), store);
    await expect(
      service.upload(
        makeJwt(),
        { buffer: Buffer.from('no soy json', 'utf-8'), originalname: 'x.json' },
        { instrumentId: INSTRUMENT_ID, classGroupId: CLASS_GROUP_ID },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza un JSON que no cumple el contrato', async () => {
    const service = new OfficialReportImportService(buildMockDb(), store);
    await expect(
      uploadReport(service, { schemaVersion: '1.0' } as unknown as OfficialReportImportFile),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza sin organización activa', async () => {
    const service = new OfficialReportImportService(buildMockDb(), store);
    await expect(
      service.upload(
        makeJwt(null),
        { buffer: toBuffer(buildReport()), originalname: 'x.json' },
        { instrumentId: INSTRUMENT_ID, classGroupId: CLASS_GROUP_ID },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rechaza un instrumento no visible para la org', async () => {
    const service = new OfficialReportImportService(buildMockDb({ instrumentFound: false }), store);
    await expect(uploadReport(service)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rechaza un curso de otra org', async () => {
    const service = new OfficialReportImportService(buildMockDb({ classGroupFound: false }), store);
    await expect(uploadReport(service)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OfficialReportImportService — preview', () => {
  let store: OfficialReportPreviewStore;

  beforeEach(() => {
    store = new OfficialReportPreviewStore();
  });

  it('corre los gates del informe real y habilita el confirm, sin persistir', async () => {
    const captured = emptyCaptured();
    const service = new OfficialReportImportService(buildMockDb({}, captured), store);
    const { previewToken } = await uploadReport(service);

    const out = await service.preview(makeJwt(), previewToken);

    expect(out.canConfirm).toBe(true);
    expect(out.gates.filter((g) => g.blocking && g.status === 'failed')).toEqual([]);
    expect(out.items).toHaveLength(TABLA_1.length);
    expect(out.skillAxes.every((a) => a.ok)).toBe(true);
    // El preview NO persiste: es su contrato.
    expect(captured.itemStats).toEqual([]);
    expect(captured.assessmentResults).toEqual([]);
  });

  it('advierte si el curso del informe no coincide con el seleccionado', async () => {
    const service = new OfficialReportImportService(buildMockDb(), store);
    const { previewToken } = await uploadReport(
      service,
      buildReport({ report: { ...buildReport().report, courseLabel: '5 B' } }),
    );

    const out = await service.preview(makeJwt(), previewToken);
    expect(out.warnings.join(' ')).toContain('5 B');
  });

  it('rechaza un token de otra organización', async () => {
    const service = new OfficialReportImportService(buildMockDb(), store);
    const { previewToken } = await uploadReport(service);

    await expect(service.preview(makeJwt(ORG_B), previewToken)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rechaza un token inexistente', async () => {
    const service = new OfficialReportImportService(buildMockDb(), store);
    await expect(
      service.preview(makeJwt(), '00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OfficialReportImportService — confirm', () => {
  let store: OfficialReportPreviewStore;

  beforeEach(() => {
    store = new OfficialReportPreviewStore();
  });

  const reportWithStudents = buildReport({
    levelDistribution: [
      { level: 'II', pct: 50 },
      { level: 'III', pct: 50 },
    ],
    students: [
      { listNumber: '01', name: 'ARREDONDO SABALLA C.', level: 'III' },
      { listNumber: '02', name: 'MUÑOZ ROJAS B.', level: 'II' },
    ],
  });

  it('crea el assessment como aggregate_only y escribe el read-model importado', async () => {
    const captured = emptyCaptured();
    const service = new OfficialReportImportService(buildMockDb({}, captured), store);
    const { previewToken } = await uploadReport(service);

    const out = await service.confirm(makeJwt(), { previewToken, studentMatches: [] });

    const assessment = captured.assessments[0]![0] as Record<string, unknown>;
    expect(assessment.dataGranularity).toBe('aggregate_only');
    expect(assessment.orgId).toBe(ORG_A);

    // El curso del informe queda asignado a la evaluación.
    expect(captured.courseAssignments[0]![0]).toMatchObject({
      assessmentId: ASSESSMENT_ID,
      classGroupId: CLASS_GROUP_ID,
    });

    expect(out.itemStatsWritten).toBe(TABLA_1.length);
    expect(out.skillStatsWritten).toBe(2); // Localizar + Reflexionar
    expect(out.status).toBe('completed');

    const itemRow = captured.itemStats[0]![0] as Record<string, unknown>;
    expect(itemRow.source).toBe('imported');
    expect(itemRow.classGroupId).toBe(CLASS_GROUP_ID);
    const skillRow = captured.skillStats[0]![0] as Record<string, unknown>;
    expect(skillRow.source).toBe('imported');
    // El calculador devuelve 0..1; la BD guarda 0..100.
    expect(Number(skillRow.percentage)).toBeGreaterThan(1);
  });

  it('escribe assessment_level_stats con los conteos por banda desde levelDistribution', async () => {
    const captured = emptyCaptured();
    const service = new OfficialReportImportService(buildMockDb({}, captured), store);
    // Informe con Gráfico 1: 50% Nivel II, 50% Nivel III sobre N=43.
    const { previewToken } = await uploadReport(service, reportWithStudents);

    await service.confirm(makeJwt(), { previewToken, studentMatches: [] });

    expect(captured.levelStats).toHaveLength(1);
    const rows = captured.levelStats[0] as Record<string, unknown>[];
    // round(50/100 × 43) = 22 en ambas bandas presentes; Nivel I (0%) no se escribe.
    expect(rows).toEqual([
      expect.objectContaining({
        classGroupId: CLASS_GROUP_ID,
        performanceBandId: 'band-2',
        studentCount: 22,
        source: 'imported',
      }),
      expect.objectContaining({
        performanceBandId: 'band-3',
        studentCount: 22,
        source: 'imported',
      }),
    ]);
  });

  it('no escribe assessment_level_stats cuando el informe no trae Gráfico 1', async () => {
    const captured = emptyCaptured();
    const service = new OfficialReportImportService(buildMockDb({}, captured), store);
    // buildReport() por defecto trae levelDistribution: [].
    const { previewToken } = await uploadReport(service);

    await service.confirm(makeJwt(), { previewToken, studentMatches: [] });

    expect(captured.levelStats).toEqual([]);
  });

  it('registra el import_job ya completado, en la misma transacción', async () => {
    const captured = emptyCaptured();
    const service = new OfficialReportImportService(buildMockDb({}, captured), store);
    const { previewToken } = await uploadReport(service);

    const out = await service.confirm(makeJwt(), { previewToken, studentMatches: [] });

    const job = captured.importJobs[0]![0] as Record<string, unknown>;
    expect(job.type).toBe('dia_official_report');
    expect(job.status).toBe('completed');
    expect(job.completedAt).toBeInstanceOf(Date);
    expect(out.jobId).toBe(JOB_ID);
  });

  it('sin `students` importa solo la cohorte: 0 resultados por alumno (§6.4)', async () => {
    const captured = emptyCaptured();
    const service = new OfficialReportImportService(buildMockDb({}, captured), store);
    const { previewToken } = await uploadReport(service);

    const out = await service.confirm(makeJwt(), { previewToken, studentMatches: [] });

    expect(out.studentResultsWritten).toBe(0);
    expect(captured.assessmentResults).toEqual([]);
    expect(out.itemStatsWritten).toBeGreaterThan(0);
  });

  it('escribe el nivel aprobado por el humano con metric_type=band y percentage NULL', async () => {
    const captured = emptyCaptured();
    const service = new OfficialReportImportService(buildMockDb({}, captured), store);
    const { previewToken } = await uploadReport(service, reportWithStudents);

    const out = await service.confirm(makeJwt(), {
      previewToken,
      studentMatches: [
        { reportIndex: 0, studentId: STUDENT_1 },
        { reportIndex: 1, studentId: STUDENT_2 },
      ],
    });

    expect(out.studentResultsWritten).toBe(2);
    const rows = captured.assessmentResults[0]! as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({
      studentId: STUDENT_1,
      metricType: 'band',
      bandLabel: 'Nivel III',
      performanceBandId: 'band-3',
      // No tenemos el % del alumno, solo su nivel: inventarlo sesgaría dashboards.
      percentage: null,
      totalScore: null,
    });
    expect(rows[1]).toMatchObject({ studentId: STUDENT_2, performanceBandId: 'band-2' });
  });

  it('NUNCA usa su propia propuesta de match: sin aprobación humana no escribe niveles', async () => {
    // El matcher cruza los 2 alumnos con confianza 1.0, pero el confirm llega sin
    // `studentMatches` → no se escribe ninguno (CLAUDE.md §8.3).
    const captured = emptyCaptured();
    const service = new OfficialReportImportService(buildMockDb({}, captured), store);
    const { previewToken } = await uploadReport(service, reportWithStudents);

    const preview = await service.preview(makeJwt(), previewToken);
    expect(preview.students[0]!.proposedStudentId).toBe(STUDENT_1);

    const out = await service.confirm(makeJwt(), { previewToken, studentMatches: [] });

    expect(out.studentResultsWritten).toBe(0);
    expect(captured.assessmentResults).toEqual([]);
    expect(out.studentsSkipped).toBe(2);
    expect(out.status).toBe('partial');
  });

  it('reporta como partial cuando quedan alumnos del informe sin aprobar', async () => {
    const service = new OfficialReportImportService(buildMockDb(), store);
    const { previewToken } = await uploadReport(service, reportWithStudents);

    const out = await service.confirm(makeJwt(), {
      previewToken,
      studentMatches: [{ reportIndex: 0, studentId: STUDENT_1 }],
    });

    expect(out.status).toBe('partial');
    expect(out.studentsSkipped).toBe(1);
    expect(out.studentResultsWritten).toBe(1);
  });

  it('rechaza asignar un alumno que no está matriculado en el curso del informe', async () => {
    const service = new OfficialReportImportService(buildMockDb(), store);
    const { previewToken } = await uploadReport(service, reportWithStudents);

    await expect(
      service.confirm(makeJwt(), {
        previewToken,
        studentMatches: [{ reportIndex: 0, studentId: OTHER_STUDENT }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza asignar el mismo alumno a dos filas del informe', async () => {
    const service = new OfficialReportImportService(buildMockDb(), store);
    const { previewToken } = await uploadReport(service, reportWithStudents);

    await expect(
      service.confirm(makeJwt(), {
        previewToken,
        studentMatches: [
          { reportIndex: 0, studentId: STUDENT_1 },
          { reportIndex: 1, studentId: STUDENT_1 },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza un nivel que no existe entre las bandas del instrumento', async () => {
    const service = new OfficialReportImportService(buildMockDb(), store);
    const { previewToken } = await uploadReport(
      service,
      buildReport({
        students: [{ listNumber: '01', name: 'ARREDONDO SABALLA C.', level: 'IX' }],
      }),
    );

    await expect(
      service.confirm(makeJwt(), {
        previewToken,
        studentMatches: [{ reportIndex: 0, studentId: STUDENT_1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('409 al importar sobre un assessment item_level: en conflicto gana el granular (§9.3)', async () => {
    const captured = emptyCaptured();
    const service = new OfficialReportImportService(
      buildMockDb(
        {
          assessmentRow: { id: ASSESSMENT_ID, orgId: ORG_A, dataGranularity: 'item_level' },
        },
        captured,
      ),
      store,
    );
    const { previewToken } = await uploadReport(service, buildReport(), {
      assessmentId: ASSESSMENT_ID,
    });

    await expect(
      service.confirm(makeJwt(), { previewToken, studentMatches: [] }),
    ).rejects.toBeInstanceOf(ConflictException);
    // Nada escrito: el informe agregado no degrada el dato granular.
    expect(captured.itemStats).toEqual([]);
  });

  it('reusa un assessment aggregate_only existente sin crear otro', async () => {
    const captured = emptyCaptured();
    const service = new OfficialReportImportService(
      buildMockDb(
        {
          assessmentRow: { id: ASSESSMENT_ID, orgId: ORG_A, dataGranularity: 'aggregate_only' },
        },
        captured,
      ),
      store,
    );
    const { previewToken } = await uploadReport(service, buildReport(), {
      assessmentId: ASSESSMENT_ID,
    });

    const out = await service.confirm(makeJwt(), { previewToken, studentMatches: [] });

    expect(out.assessmentId).toBe(ASSESSMENT_ID);
    expect(captured.assessments).toEqual([]);
    expect(captured.itemStats[0]).toHaveLength(TABLA_1.length);
  });

  it('rechaza un assessment de otra organización', async () => {
    const service = new OfficialReportImportService(
      buildMockDb({
        assessmentRow: { id: ASSESSMENT_ID, orgId: ORG_B, dataGranularity: 'aggregate_only' },
      }),
      store,
    );
    const { previewToken } = await uploadReport(service, buildReport(), {
      assessmentId: ASSESSMENT_ID,
    });

    await expect(
      service.confirm(makeJwt(), { previewToken, studentMatches: [] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rechaza un informe que no pasa los gates bloqueantes, aunque el preview haya sido otro', async () => {
    const captured = emptyCaptured();
    // Los gates se recalculan en el confirm: acá el instrumento no tiene el ítem 19.
    const service = new OfficialReportImportService(
      buildMockDb(
        {
          itemRows: INSTRUMENT_ITEMS.filter((i) => i.position !== 19).map((i) => ({
            id: i.id,
            position: i.position,
            scoringConfig: { points: i.points },
          })),
        },
        captured,
      ),
      store,
    );
    const { previewToken } = await uploadReport(service);

    await expect(
      service.confirm(makeJwt(), { previewToken, studentMatches: [] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(captured.itemStats).toEqual([]);
  });

  it('el previewToken es de un solo uso', async () => {
    const service = new OfficialReportImportService(buildMockDb(), store);
    const { previewToken } = await uploadReport(service);

    await service.confirm(makeJwt(), { previewToken, studentMatches: [] });

    await expect(
      service.confirm(makeJwt(), { previewToken, studentMatches: [] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rechaza un token de otra organización', async () => {
    const service = new OfficialReportImportService(buildMockDb(), store);
    const { previewToken } = await uploadReport(service);

    await expect(
      service.confirm(makeJwt(ORG_B), { previewToken, studentMatches: [] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
