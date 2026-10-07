import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { responses } from '@soe/db';
import type { Database } from '../../database/database.types';

export async function countStudentsWithPendingResponses(
  tx: Database,
  assessmentId: string,
  studentFilter: readonly string[] | null,
): Promise<number> {
  if (studentFilter !== null && studentFilter.length === 0) return 0;
  const conditions = [eq(responses.assessmentId, assessmentId), isNull(responses.isCorrect)];
  if (studentFilter !== null) conditions.push(inArray(responses.studentId, [...studentFilter]));
  const [row] = await tx
    .select({ n: sql<number>`count(distinct ${responses.studentId})::int` })
    .from(responses)
    .where(and(...conditions));
  return Number(row?.n ?? 0);
}
