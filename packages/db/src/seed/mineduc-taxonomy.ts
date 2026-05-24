import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { mineducCurriculumSchema } from '@soe/types';
import type { Database } from '../client';
import { grades, subjects } from '../schema/academic';
import { curricula, taxonomyNodes } from '../schema/curriculum';

const DATASET_PATH = resolve(__dirname, '../../data/mineduc-2024.json');

export async function seedMineducTaxonomy(db: Database): Promise<void> {
  console.log('Seeding MINEDUC taxonomy nodes...');

  const raw = JSON.parse(await readFile(DATASET_PATH, 'utf-8'));
  const data = mineducCurriculumSchema.parse(raw);

  const [mineduc] = await db
    .select({ id: curricula.id })
    .from(curricula)
    .where(and(eq(curricula.type, 'mineduc'), eq(curricula.version, '2024')))
    .limit(1);
  if (!mineduc) {
    throw new Error('MINEDUC 2024 curriculum row missing — run base seed first');
  }

  const subjectRows = await db
    .select({ id: subjects.id, code: subjects.code })
    .from(subjects);
  const gradeRows = await db
    .select({ id: grades.id, shortName: grades.shortName })
    .from(grades);

  const subjectIdByCode = new Map(subjectRows.map((s) => [s.code, s.id]));
  const gradeIdByShortName = new Map(gradeRows.map((g) => [g.shortName, g.id]));

  let axisCount = 0;
  let oaCount = 0;

  for (const subject of data.subjects) {
    const subjectId = subjectIdByCode.get(subject.code);
    if (!subjectId) {
      throw new Error(`Subject with code "${subject.code}" not found — run base seed first`);
    }

    for (const grade of subject.grades) {
      const gradeId = gradeIdByShortName.get(grade.code);
      if (!gradeId) {
        throw new Error(`Grade with shortName "${grade.code}" not found — run base seed first`);
      }

      let axisOrder = 0;
      for (const axis of grade.axes) {
        const axisCode = `${subject.code}-${grade.code}-AX-${axis.code}`;
        const axisName = `${axis.name} · ${grade.code}`;

        const [axisRow] = await db
          .insert(taxonomyNodes)
          .values({
            curriculumId: mineduc.id,
            type: 'axis',
            code: axisCode,
            name: axisName,
            subjectId,
            gradeId,
            order: axisOrder,
            depth: 1,
          })
          .onConflictDoUpdate({
            target: [taxonomyNodes.curriculumId, taxonomyNodes.code],
            targetWhere: sql`${taxonomyNodes.code} IS NOT NULL`,
            set: {
              name: axisName,
              subjectId,
              gradeId,
              order: axisOrder,
              depth: 1,
            },
          })
          .returning({ id: taxonomyNodes.id });
        if (!axisRow) {
          throw new Error(`Failed to upsert axis ${axisCode}`);
        }
        axisCount += 1;
        axisOrder += 1;

        let oaOrder = 0;
        for (const objective of axis.objectives) {
          const oaCode = `${subject.code}-${grade.code}-OA-${objective.code}`;
          await db
            .insert(taxonomyNodes)
            .values({
              curriculumId: mineduc.id,
              parentId: axisRow.id,
              type: 'learning_objective',
              code: oaCode,
              name: objective.name,
              description: objective.description,
              subjectId,
              gradeId,
              order: oaOrder,
              depth: 2,
            })
            .onConflictDoUpdate({
              target: [taxonomyNodes.curriculumId, taxonomyNodes.code],
              targetWhere: sql`${taxonomyNodes.code} IS NOT NULL`,
              set: {
                parentId: axisRow.id,
                name: objective.name,
                description: objective.description,
                subjectId,
                gradeId,
                order: oaOrder,
                depth: 2,
              },
            });
          oaCount += 1;
          oaOrder += 1;
        }
      }
    }
  }

  console.log(`  → MINEDUC: ${axisCount} ejes, ${oaCount} OAs.`);
}
