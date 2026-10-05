/**
 * Golden de regresión del tablero maestro (SOLO LECTURA).
 *
 * Reproduce tal cual las queries de `getTakes`, `resolveTomaAssessments` y `loadMatrixRows`
 * de `apps/api/src/master-board/master-board.service.ts` (código de main, vista de directivo:
 * alcance completo, sin filtros de grado ni asignatura) y deja, por toma, la suma de
 * `score_sum` / `max_sum` y el máximo de `student_count` por (curso, asignatura).
 *
 * La salida es determinística y no lleva datos personales: ids, códigos de grado y
 * asignatura, nombre de sección y nombre de instrumento. Además de los UUID (que cambian
 * al recrear la BDD) cada celda trae una clave estable `gradeCode:sección:subjectCode`.
 *
 *   DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db golden:master-board [--org <uuid>] [--out <ruta>]
 */
import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

config({ path: resolve(__dirname, '../../../../.env') });

import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  INSTRUMENT_APPLICATION_PERIODS,
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  INSTRUMENT_TYPE_LABELS,
  type InstrumentApplicationPeriod,
  type InstrumentType,
} from '@soe/types';
import { createDbClient, type Database } from '../client';
import { withOrgContext } from '../with-org-context';
import { academicYears } from '../schema/organizations';
import { assessments } from '../schema/assessments';
import { assessmentItemStats } from '../schema/results';
import { instruments } from '../schema/instruments';
import { classGroups, grades, subjects } from '../schema/academic';

const CSCJ_ORG_ID = 'c5c10000-0000-0000-0000-000000000001';
const DEFAULT_OUT = resolve(__dirname, '../../../../docs/golden/master-board-local.json');

type Take = {
  key: string;
  label: string;
  academicYearId: string;
  year: number;
  instrumentType: InstrumentType;
  applicationPeriod: InstrumentApplicationPeriod | null;
  assessmentCount: number;
};

function arg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

function buildTakeLabel(
  instrumentType: InstrumentType,
  applicationPeriod: InstrumentApplicationPeriod | null,
  year: number | null,
): string {
  const parts: string[] = [INSTRUMENT_TYPE_LABELS[instrumentType]];
  if (applicationPeriod) parts.push(INSTRUMENT_APPLICATION_PERIOD_LABELS[applicationPeriod]);
  if (year !== null) parts.push(String(year));
  return parts.join(' ');
}

function periodOrder(period: InstrumentApplicationPeriod | null): number {
  if (period === null) return INSTRUMENT_APPLICATION_PERIODS.length;
  return INSTRUMENT_APPLICATION_PERIODS.indexOf(period);
}

async function loadTakes(tx: Database, orgId: string): Promise<Take[]> {
  const conditions: SQL[] = [eq(assessments.orgId, orgId), isNull(instruments.deletedAt)];
  const rows = await tx
    .select({
      academicYearId: classGroups.academicYearId,
      year: academicYears.year,
      instrumentType: instruments.type,
      applicationPeriod: instruments.applicationPeriod,
      assessmentCount: sql<number>`count(distinct ${assessments.id})::int`,
    })
    .from(assessmentItemStats)
    .innerJoin(assessments, eq(assessments.id, assessmentItemStats.assessmentId))
    .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
    .innerJoin(classGroups, eq(classGroups.id, assessmentItemStats.classGroupId))
    .innerJoin(academicYears, eq(academicYears.id, classGroups.academicYearId))
    .where(and(...conditions))
    .groupBy(
      classGroups.academicYearId,
      academicYears.year,
      instruments.type,
      instruments.applicationPeriod,
    );

  return rows
    .map((row) => {
      const instrumentType = row.instrumentType as InstrumentType;
      return {
        key: `${row.academicYearId}:${instrumentType}:${row.applicationPeriod ?? '_'}`,
        label: buildTakeLabel(instrumentType, row.applicationPeriod, row.year),
        academicYearId: row.academicYearId,
        year: row.year,
        instrumentType,
        applicationPeriod: row.applicationPeriod,
        assessmentCount: Number(row.assessmentCount ?? 0),
      };
    })
    .sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      if (a.instrumentType !== b.instrumentType) {
        return a.instrumentType.localeCompare(b.instrumentType, 'es');
      }
      return periodOrder(a.applicationPeriod) - periodOrder(b.applicationPeriod);
    });
}

async function resolveTomaAssessmentIds(
  tx: Database,
  orgId: string,
  take: Take,
): Promise<string[]> {
  const conditions: SQL[] = [eq(assessments.orgId, orgId), isNull(instruments.deletedAt)];
  conditions.push(sql`${instruments.type}::text = ${take.instrumentType}`);
  if (take.applicationPeriod) {
    conditions.push(sql`${instruments.applicationPeriod}::text = ${take.applicationPeriod}`);
  }
  conditions.push(eq(classGroups.academicYearId, take.academicYearId));

  const rows = await tx
    .selectDistinct({ assessmentId: assessments.id })
    .from(assessmentItemStats)
    .innerJoin(assessments, eq(assessments.id, assessmentItemStats.assessmentId))
    .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
    .innerJoin(classGroups, eq(classGroups.id, assessmentItemStats.classGroupId))
    .where(and(...conditions));
  return rows.map((row) => row.assessmentId).sort();
}

async function loadMatrixRows(tx: Database, assessmentIds: string[]) {
  const conditions: SQL[] = [
    inArray(assessments.id, assessmentIds),
    sql`${instruments.subjectId} is not null`,
  ];
  return tx
    .select({
      gradeId: classGroups.gradeId,
      gradeName: grades.name,
      gradeOrder: grades.order,
      classGroupId: assessmentItemStats.classGroupId,
      classGroupName: classGroups.name,
      subjectId: subjects.id,
      subjectName: subjects.name,
      subjectShortName: subjects.shortName,
      scoreSum: sql<string | null>`sum(${assessmentItemStats.scoreSum}::numeric)`,
      maxSum: sql<string | null>`sum(${assessmentItemStats.maxSum}::numeric)`,
      studentsAssessed: sql<number>`max(${assessmentItemStats.studentCount})::int`,
      assessmentIds: sql<string[]>`array_agg(distinct ${assessments.id})`,
    })
    .from(assessmentItemStats)
    .innerJoin(assessments, eq(assessments.id, assessmentItemStats.assessmentId))
    .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
    .innerJoin(subjects, eq(subjects.id, instruments.subjectId))
    .innerJoin(classGroups, eq(classGroups.id, assessmentItemStats.classGroupId))
    .innerJoin(grades, eq(grades.id, classGroups.gradeId))
    .where(and(...conditions))
    .groupBy(
      classGroups.gradeId,
      grades.name,
      grades.order,
      assessmentItemStats.classGroupId,
      classGroups.name,
      subjects.id,
      subjects.name,
      subjects.shortName,
    );
}

async function loadCodes(tx: Database) {
  const gradeRows = await tx.select({ id: grades.id, code: grades.code }).from(grades);
  const subjectRows = await tx.select({ id: subjects.id, code: subjects.code }).from(subjects);
  return {
    gradeCode: new Map(gradeRows.map((row) => [row.id, row.code])),
    subjectCode: new Map(subjectRows.map((row) => [row.id, row.code])),
  };
}

async function loadInstrumentNames(tx: Database, orgId: string) {
  const rows = await tx
    .select({ assessmentId: assessments.id, name: instruments.name })
    .from(assessments)
    .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
    .where(eq(assessments.orgId, orgId));
  return new Map(rows.map((row) => [row.assessmentId, row.name]));
}

async function buildGolden(db: Database, orgId: string) {
  return withOrgContext(db, orgId, async (tx) => {
    const codes = await loadCodes(tx);
    const instrumentNameByAssessment = await loadInstrumentNames(tx, orgId);
    const takes = await loadTakes(tx, orgId);
    const yearRows = await tx
      .select({ id: academicYears.id, year: academicYears.year })
      .from(academicYears)
      .where(eq(academicYears.orgId, orgId))
      .orderBy(desc(academicYears.year));

    const goldenTakes = [];
    for (const take of takes) {
      const assessmentIds = await resolveTomaAssessmentIds(tx, orgId, take);
      const rows = assessmentIds.length ? await loadMatrixRows(tx, assessmentIds) : [];
      const cells = rows
        .map((row) => {
          const gradeCode = codes.gradeCode.get(row.gradeId) ?? row.gradeId;
          const subjectCode = codes.subjectCode.get(row.subjectId) ?? row.subjectId;
          const cellAssessmentIds = [...row.assessmentIds].sort();
          return {
            stableKey: `${gradeCode}:${row.classGroupName}:${subjectCode}`,
            gradeCode,
            gradeOrder: row.gradeOrder,
            classGroupName: row.classGroupName,
            subjectCode,
            classGroupId: row.classGroupId,
            subjectId: row.subjectId,
            scoreSum: row.scoreSum,
            maxSum: row.maxSum,
            studentsAssessed: row.studentsAssessed,
            assessmentIds: cellAssessmentIds,
            instruments: [
              ...new Set(cellAssessmentIds.map((id) => instrumentNameByAssessment.get(id) ?? id)),
            ].sort(),
          };
        })
        .sort(
          (a, b) =>
            a.gradeOrder - b.gradeOrder ||
            a.classGroupName.localeCompare(b.classGroupName) ||
            a.subjectCode.localeCompare(b.subjectCode),
        );
      goldenTakes.push({
        ...take,
        resolvedAssessmentCount: assessmentIds.length,
        assessmentIds,
        cellCount: cells.length,
        cells,
      });
    }

    return {
      source:
        'apps/api/src/master-board/master-board.service.ts (main): getTakes + resolveTomaAssessments + loadMatrixRows, alcance completo',
      orgId,
      academicYears: yearRows.map((row) => ({ id: row.id, year: row.year })),
      takeCount: goldenTakes.length,
      takes: goldenTakes,
    };
  });
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Falta DATABASE_ADMIN_URL (o DATABASE_URL) en el entorno');
  const orgId = arg('org') ?? CSCJ_ORG_ID;
  const out = resolve(arg('out') ?? DEFAULT_OUT);

  const db = createDbClient(databaseUrl, { maxConnections: 1 });
  try {
    const golden = await buildGolden(db, orgId);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(golden, null, 2)}\n`);
    console.log(`[golden-master-board] ${golden.takeCount} tomas → ${out}`);
    for (const take of golden.takes) {
      console.log(
        `  ${take.label} · ${take.assessmentCount} evaluaciones · ${take.cellCount} celdas (curso × asignatura)`,
      );
    }
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error('[golden-master-board] falló:', err);
  process.exit(1);
});
