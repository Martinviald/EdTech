import { Injectable } from '@nestjs/common';
import { and, eq, isNull, lt } from 'drizzle-orm';
import {
  skillResults,
  studentEnrollments,
  students,
  withOrgContext,
} from '@soe/db';
import {
  remedialPlanContentSchema,
  type RemedialMaterialType,
  type RemedialPlanContent,
} from '@soe/types';
import { InjectDb, type Database } from '../../database/database.types';
import { LlmService } from '../../llm/llm.service';
import { parseModelJson } from '../prompts/curriculum-context.prompt';
import {
  buildGroupPlanPrompt,
  GROUP_PLAN_PROMPT_VERSION,
  type GroupPlanAggregates,
} from '../prompts/group-plan.prompt';
import type {
  RemedialGenerationInput,
  RemedialGenerationResult,
  RemedialGenerator,
} from '../remedial.generator';

/** Umbral de % de logro (0..100) bajo el cual un alumno entra al grupo remedial. */
const BELOW_THRESHOLD_PCT = 60;

/**
 * Generador del plan remedial por grupo (H9.4).
 *
 * La AGRUPACIÓN es DETERMINISTA en backend: consulta los alumnos del
 * `classGroupId` que están bajo umbral en la habilidad `nodeId` (vía
 * `skill_results`), calcula `studentCount` y el promedio. La IA SOLO recibe
 * AGREGADOS anónimos + contexto RAG y produce `groupLabel` + `sequence`. CERO PII
 * al LLM (Ley 19.628). Las queries corren dentro de `withOrgContext` con `tx`.
 */
@Injectable()
export class GroupPlanGenerator implements RemedialGenerator {
  readonly type: RemedialMaterialType = 'group_plan';

  constructor(
    private readonly llm: LlmService,
    @InjectDb() private readonly db: Database,
  ) {}

  async generate(
    input: RemedialGenerationInput,
  ): Promise<RemedialGenerationResult> {
    const nodeId = input.material.nodeId;
    if (!nodeId) {
      throw new Error('El plan por grupo requiere un nodeId (habilidad objetivo)');
    }
    const classGroupId = input.material.classGroupId;
    if (!classGroupId) {
      throw new Error('El plan por grupo requiere un classGroupId (cohorte)');
    }

    const aggregates = await this.computeAggregates(
      input.orgId,
      classGroupId,
      nodeId,
    );

    const { system, prompt } = buildGroupPlanPrompt(input.curriculum, aggregates);
    const raw = await this.llm.complete(system, prompt, input.orgId, 'remedial');

    const json = parseModelJson(raw);
    const result = remedialPlanContentSchema.safeParse(json);
    if (!result.success) {
      throw new Error(
        `El plan generado no cumple el schema: ${result.error.message}`,
      );
    }

    // El studentCount es DETERMINISTA: lo fijamos desde backend, nunca confiamos
    // en el número que devuelva el modelo.
    const content: RemedialPlanContent = {
      ...result.data,
      studentCount: aggregates.studentCount,
    };

    return {
      content,
      promptVersion: GROUP_PLAN_PROMPT_VERSION,
      // Auditoría: solo agregados anónimos + contexto curricular. SIN PII.
      audit: { curriculum: input.curriculum, aggregates },
    };
  }

  /**
   * Agrupación determinista: alumnos del classGroup (enrollment activo) que están
   * bajo umbral en `skill_results` para el `nodeId`. Devuelve solo agregados
   * (conteo + promedio), nunca identidades.
   */
  private async computeAggregates(
    orgId: string,
    classGroupId: string,
    nodeId: string,
  ): Promise<GroupPlanAggregates> {
    return withOrgContext(this.db, orgId, async (tx) => {
      const rows = await tx
        .select({ percentage: skillResults.percentage })
        .from(skillResults)
        .innerJoin(students, eq(skillResults.studentId, students.id))
        .innerJoin(
          studentEnrollments,
          eq(studentEnrollments.studentId, students.id),
        )
        .where(
          and(
            eq(skillResults.nodeId, nodeId),
            eq(students.orgId, orgId),
            isNull(students.deletedAt),
            eq(studentEnrollments.classGroupId, classGroupId),
            eq(studentEnrollments.status, 'active'),
            lt(skillResults.percentage, String(BELOW_THRESHOLD_PCT)),
          ),
        );

      const studentCount = rows.length;
      const pcts = rows
        .map((r) => (r.percentage === null ? null : Number(r.percentage)))
        .filter((p): p is number => p !== null && Number.isFinite(p));
      const averagePct =
        pcts.length > 0
          ? Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 100) / 100
          : null;

      return {
        studentCount,
        thresholdPct: BELOW_THRESHOLD_PCT,
        averagePct,
      };
    });
  }
}
