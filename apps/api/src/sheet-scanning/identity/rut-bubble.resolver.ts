import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import {
  printedSheets,
  sheetLayouts,
  sheetPrintRuns,
  studentEnrollments,
  students,
  withOrgContext,
} from '@soe/db';
import { normalizeRut, parseOmrQrPayload } from '@soe/types';
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

interface PrintedSheetLookup {
  printedSheetId: string;
  specHash: string;
  pageCount: number;
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
    const qrRaw = page.identity.qrRaw ?? null;
    if (qrRaw === null) {
      return unresolvedIdentityCandidate({ motivo: 'qr_esquina_ilegible', qr: null });
    }
    const qrPayload = parseOmrQrPayload(qrRaw);
    if (qrPayload === null) {
      return unresolvedIdentityCandidate({ motivo: 'qr_esquina_ilegible', qr: qrRaw });
    }

    const sheet = await this.findPrintedSheet(orgId, qrPayload.printedSheetId);
    if (!sheet) {
      return unresolvedIdentityCandidate({
        motivo: 'hoja_no_encontrada',
        qr: qrRaw,
        printedSheetId: qrPayload.printedSheetId,
      });
    }

    if (qrPayload.layoutHash !== sheet.specHash.toLowerCase()) {
      return {
        printedSheetId: sheet.printedSheetId,
        studentId: null,
        confidence: 0,
        evidence: { qr: qrRaw, qrLayoutHash: qrPayload.layoutHash, layoutSpecHash: sheet.specHash },
        needsHumanConfirmation: false,
        batchRejection: {
          reason: `El instrumento fue editado después de imprimir las hojas: el diseño impreso (hash ${qrPayload.layoutHash}) no coincide con el diseño de la tirada (hash ${sheet.specHash}). Reimprime las hojas con el diseño vigente y vuelve a escanear el lote completo.`,
        },
      };
    }

    if (qrPayload.pageIndex >= sheet.pageCount) {
      return unresolvedIdentityCandidate({
        motivo: 'page_index_fuera_de_rango',
        qr: qrRaw,
        pageIndex: qrPayload.pageIndex,
        pageCount: sheet.pageCount,
      });
    }

    return this.resolveStudentByRut(orgId, page, context, sheet.printedSheetId, qrRaw);
  }

  private async resolveStudentByRut(
    orgId: string,
    page: ScannedPage,
    context: IdentityResolutionContext,
    printedSheetId: string,
    qrRaw: string,
  ): Promise<IdentityCandidate> {
    const raw = page.identity.raw;
    if (raw === null || raw.length < 2 || !RUT_RAW_PATTERN.test(raw)) {
      return this.sheetOnlyCandidate(printedSheetId, qrRaw, {
        motivo: 'rut_ilegible',
        rut: raw,
      });
    }

    const rut = this.normalizeRawDigits(raw);
    if (rut === null) {
      return this.sheetOnlyCandidate(printedSheetId, qrRaw, {
        motivo: 'rut_dv_invalido',
        rut: raw,
      });
    }

    const matches = await this.findRosterMatches(orgId, context.printRunId, rut);
    if (matches.length === 0) {
      return this.sheetOnlyCandidate(printedSheetId, qrRaw, { motivo: 'rut_sin_match', rut });
    }
    if (matches.length > 1) {
      return this.sheetOnlyCandidate(printedSheetId, qrRaw, {
        motivo: 'rut_duplicado_en_roster',
        rut,
      });
    }

    const student = matches[0];
    return {
      printedSheetId,
      studentId: student.id,
      confidence: page.identity.confidence,
      evidence: { qr: qrRaw, rut, alumno: `${student.firstName} ${student.lastName}` },
      needsHumanConfirmation: false,
      batchRejection: null,
    };
  }

  private sheetOnlyCandidate(
    printedSheetId: string,
    qrRaw: string,
    evidence: Record<string, unknown>,
  ): IdentityCandidate {
    return {
      printedSheetId,
      studentId: null,
      confidence: 0,
      evidence: { ...evidence, qr: qrRaw },
      needsHumanConfirmation: true,
      batchRejection: null,
    };
  }

  private async findPrintedSheet(
    orgId: string,
    printedSheetId: string,
  ): Promise<PrintedSheetLookup | null> {
    const rows = await withOrgContext(this.db, orgId, (tx) =>
      tx
        .select({
          printedSheetId: printedSheets.id,
          specHash: sheetLayouts.specHash,
          spec: sheetLayouts.spec,
        })
        .from(printedSheets)
        .innerJoin(sheetPrintRuns, eq(printedSheets.printRunId, sheetPrintRuns.id))
        .innerJoin(sheetLayouts, eq(sheetPrintRuns.layoutId, sheetLayouts.id))
        .where(and(eq(printedSheets.id, printedSheetId), eq(printedSheets.orgId, orgId)))
        .limit(1),
    );

    const row = rows[0];
    if (!row) return null;
    return {
      printedSheetId: row.printedSheetId,
      specHash: row.specHash,
      pageCount: row.spec.pageCount,
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
