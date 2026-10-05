/**
 * Exporta (SOLO LECTURA) el fixture anonimizado que alimenta los tests del agrupador de
 * procesos de medición: una fila por evaluación × curso asignado de la org, con los datos
 * que el agrupador usa para decidir el proceso (año, tipo, período, grado, asignatura,
 * fecha y `config.ensayo`). No lleva alumnos, nombres de personas ni RUT.
 *
 *   DATABASE_ADMIN_URL=<url> pnpm --filter @soe/db fixture:process-candidates [--org <uuid>] [--out <ruta>]
 */
import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

config({ path: resolve(__dirname, '../../../../.env') });

import { eq, sql } from 'drizzle-orm';
import { createDbClient, type Database } from '../client';
import { withOrgContext } from '../with-org-context';
import { academicYears } from '../schema/organizations';
import { assessments, assessmentCourseAssignments } from '../schema/assessments';
import { instruments } from '../schema/instruments';
import { classGroups, grades, subjects } from '../schema/academic';

const CSCJ_ORG_ID = 'c5c10000-0000-0000-0000-000000000001';
const DEFAULT_OUT = resolve(__dirname, '__fixtures__/process-candidates.json');

function arg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

async function loadCandidates(db: Database, orgId: string) {
  return withOrgContext(db, orgId, async (tx) => {
    const rows = await tx
      .select({
        assessmentId: assessments.id,
        orgId: assessments.orgId,
        academicYearId: classGroups.academicYearId,
        year: academicYears.year,
        instrumentId: instruments.id,
        instrumentType: instruments.type,
        applicationPeriod: instruments.applicationPeriod,
        taxonomyId: instruments.taxonomyId,
        instrumentGradeId: instruments.gradeId,
        gradeId: classGroups.gradeId,
        gradeCode: grades.code,
        subjectId: instruments.subjectId,
        subjectCode: subjects.code,
        classGroupId: classGroups.id,
        classGroupName: classGroups.name,
        administeredAt: assessments.administeredAt,
        ensayo: sql<number | null>`(${assessments.config} ->> 'ensayo')::int`,
        instrumentName: instruments.name,
      })
      .from(assessments)
      .innerJoin(instruments, eq(instruments.id, assessments.instrumentId))
      .innerJoin(
        assessmentCourseAssignments,
        eq(assessmentCourseAssignments.assessmentId, assessments.id),
      )
      .innerJoin(classGroups, eq(classGroups.id, assessmentCourseAssignments.classGroupId))
      .innerJoin(academicYears, eq(academicYears.id, classGroups.academicYearId))
      .innerJoin(grades, eq(grades.id, classGroups.gradeId))
      .leftJoin(subjects, eq(subjects.id, instruments.subjectId))
      .where(eq(assessments.orgId, orgId));

    return rows
      .map((row) => ({
        ...row,
        administeredAt: row.administeredAt ? row.administeredAt.toISOString() : null,
      }))
      .sort(
        (a, b) =>
          a.year - b.year ||
          a.instrumentType.localeCompare(b.instrumentType) ||
          (a.applicationPeriod ?? '').localeCompare(b.applicationPeriod ?? '') ||
          (a.ensayo ?? 0) - (b.ensayo ?? 0) ||
          a.gradeCode.localeCompare(b.gradeCode) ||
          (a.subjectCode ?? '').localeCompare(b.subjectCode ?? '') ||
          a.instrumentName.localeCompare(b.instrumentName) ||
          a.classGroupName.localeCompare(b.classGroupName) ||
          a.assessmentId.localeCompare(b.assessmentId),
      );
  });
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Falta DATABASE_ADMIN_URL (o DATABASE_URL) en el entorno');
  const orgId = arg('org') ?? CSCJ_ORG_ID;
  const out = resolve(arg('out') ?? DEFAULT_OUT);

  const db = createDbClient(databaseUrl, { maxConnections: 1 });
  try {
    const candidates = await loadCandidates(db, orgId);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(
      out,
      `${JSON.stringify({ orgId, candidateCount: candidates.length, candidates }, null, 2)}\n`,
    );
    console.log(`[export-process-candidates] ${candidates.length} candidatos → ${out}`);
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  console.error('[export-process-candidates] falló:', err);
  process.exit(1);
});
