import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { rubricCriteria, rubricLevels, rubrics } from '@soe/db';
import type { RubricModel } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';

@Injectable()
export class RubricsService {
  constructor(@InjectDb() private readonly db: Database) {}

  async getById(user: JwtPayload, rubricId: string): Promise<RubricModel> {
    const orgId = this.requireOrgId(user);

    const [rubric] = await this.db
      .select({ id: rubrics.id, name: rubrics.name, type: rubrics.type })
      .from(rubrics)
      .where(and(eq(rubrics.id, rubricId), eq(rubrics.orgId, orgId), isNull(rubrics.deletedAt)))
      .limit(1);

    if (!rubric) {
      throw new NotFoundException('No se encontró la pauta solicitada.');
    }

    const criteria = await this.db
      .select({
        id: rubricCriteria.id,
        name: rubricCriteria.name,
        description: rubricCriteria.description,
        maxPoints: rubricCriteria.maxPoints,
        order: rubricCriteria.order,
      })
      .from(rubricCriteria)
      .where(eq(rubricCriteria.rubricId, rubricId))
      .orderBy(asc(rubricCriteria.order));

    const criterionIds = criteria.map((c) => c.id);
    const levels = criterionIds.length
      ? await this.db
          .select({
            id: rubricLevels.id,
            criterionId: rubricLevels.criterionId,
            score: rubricLevels.score,
            descriptor: rubricLevels.descriptor,
            examples: rubricLevels.examples,
          })
          .from(rubricLevels)
          .where(inArray(rubricLevels.criterionId, criterionIds))
          .orderBy(desc(rubricLevels.score))
      : [];

    const levelsByCriterion = new Map<string, RubricModel['criteria'][number]['levels']>();
    for (const level of levels) {
      const bucket = levelsByCriterion.get(level.criterionId) ?? [];
      bucket.push({
        id: level.id,
        score: Number(level.score),
        descriptor: level.descriptor,
        examples: level.examples ?? null,
      });
      levelsByCriterion.set(level.criterionId, bucket);
    }

    return {
      id: rubric.id,
      name: rubric.name,
      type: rubric.type,
      criteria: criteria.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description ?? null,
        maxPoints: Number(c.maxPoints),
        order: c.order,
        levels: levelsByCriterion.get(c.id) ?? [],
      })),
    };
  }

  private requireOrgId(user: JwtPayload): string {
    if (!user.orgId) {
      throw new NotFoundException('Sin organización activa.');
    }
    return user.orgId;
  }
}
