import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { sheetPrintRuns, studentEnrollments, students, withOrgContext } from '@soe/db';
import { normalizeRut } from '@soe/types';
import type { ScannedPage } from '@soe/types';
import { InjectDb, type Database } from '../../database/database.types';
import {
  unresolvedIdentityCandidate,
  type IdentityCandidate,
  type IdentityResolutionContext,
  type SheetIdentityResolver,
} from './identity-resolver.types';

interface RosterStudent {
  id: string;
  rut: string;
  firstName: string;
  lastName: string;
}

const RUT_RAW_PATTERN = /^\d+[\dK]$/i;

@Injectable()
export class RutBubbleResolver implements SheetIdentityResolver {
  readonly mode = 'rut_bubbles' as const;

  constructor(@InjectDb() private readonly db: Database) {}

  async resolve(
    orgId: string,
    page: ScannedPage,
    context: IdentityResolutionContext,
  ): Promise<IdentityCandidate> {
    const raw = page.identity.raw;
    if (raw === null || raw.length < 2 || !RUT_RAW_PATTERN.test(raw)) {
      return unresolvedIdentityCandidate({ motivo: 'rut_ilegible', rut: raw });
    }

    const rut = this.normalizeRawDigits(raw);
    if (rut === null) {
      return unresolvedIdentityCandidate({ motivo: 'rut_dv_invalido', rut: raw });
    }

    const matches = await this.findRosterMatches(orgId, context.printRunId, rut);
    if (matches.length === 0) {
      return unresolvedIdentityCandidate({ motivo: 'rut_sin_match', rut });
    }
    if (matches.length > 1) {
      return unresolvedIdentityCandidate({ motivo: 'rut_duplicado_en_roster', rut });
    }

    const student = matches[0];
    return {
      printedSheetId: null,
      studentId: student.id,
      confidence: page.identity.confidence,
      evidence: { rut, alumno: `${student.firstName} ${student.lastName}` },
      needsHumanConfirmation: false,
      batchRejection: null,
    };
  }

  private normalizeRawDigits(raw: string): string | null {
    const body = raw.slice(0, -1).replace(/^0+/, '');
    const dv = raw.slice(-1);
    if (body.length === 0) return null;
    return normalizeRut(`${body}-${dv}`);
  }

  private async findRosterMatches(
    orgId: string,
    printRunId: string,
    rut: string,
  ): Promise<RosterStudent[]> {
    const roster = await withOrgContext(this.db, orgId, (tx) =>
      tx
        .select({
          id: students.id,
          rut: students.rut,
          firstName: students.firstName,
          lastName: students.lastName,
        })
        .from(students)
        .innerJoin(studentEnrollments, eq(studentEnrollments.studentId, students.id))
        .innerJoin(
          sheetPrintRuns,
          eq(sheetPrintRuns.classGroupId, studentEnrollments.classGroupId),
        )
        .where(
          and(
            eq(sheetPrintRuns.id, printRunId),
            eq(sheetPrintRuns.orgId, orgId),
            eq(students.orgId, orgId),
            isNull(students.deletedAt),
            eq(studentEnrollments.status, 'active'),
          ),
        ),
    );

    return roster.filter((student) => normalizeRut(student.rut) === rut);
  }
}
