import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  printedSheets,
  sheetLayouts,
  sheetPrintRuns,
  students,
  withOrgContext,
} from '@soe/db';
import { parseOmrQrPayload } from '@soe/types';
import type { ScannedPage } from '@soe/types';
import { InjectDb, type Database } from '../../database/database.types';
import {
  unresolvedIdentityCandidate,
  type IdentityCandidate,
  type SheetIdentityResolver,
} from './identity-resolver.types';

interface PrintedSheetLookup {
  printedSheetId: string;
  studentId: string | null;
  specHash: string;
  pageCount: number;
  studentFirstName: string | null;
  studentLastName: string | null;
}

@Injectable()
export class QrIdentityResolver implements SheetIdentityResolver {
  readonly mode = 'qr' as const;

  constructor(@InjectDb() private readonly db: Database) {}

  async resolve(orgId: string, page: ScannedPage): Promise<IdentityCandidate> {
    const raw = page.identity.raw;
    const payload = raw === null ? null : parseOmrQrPayload(raw);
    if (raw === null || payload === null) {
      return unresolvedIdentityCandidate({ motivo: 'qr_ilegible', qr: raw });
    }

    const sheet = await this.findPrintedSheet(orgId, payload.printedSheetId);
    if (!sheet) {
      return unresolvedIdentityCandidate({
        motivo: 'hoja_no_encontrada',
        qr: raw,
        printedSheetId: payload.printedSheetId,
      });
    }

    if (payload.layoutHash !== sheet.specHash.toLowerCase()) {
      return {
        printedSheetId: sheet.printedSheetId,
        studentId: null,
        confidence: 0,
        evidence: { qr: raw, qrLayoutHash: payload.layoutHash, layoutSpecHash: sheet.specHash },
        needsHumanConfirmation: false,
        batchRejection: {
          reason: `El instrumento fue editado después de imprimir las hojas: el diseño impreso (hash ${payload.layoutHash}) no coincide con el diseño de la tirada (hash ${sheet.specHash}). Reimprime las hojas con el diseño vigente y vuelve a escanear el lote completo.`,
        },
      };
    }

    if (payload.pageIndex >= sheet.pageCount) {
      return unresolvedIdentityCandidate({
        motivo: 'page_index_fuera_de_rango',
        qr: raw,
        pageIndex: payload.pageIndex,
        pageCount: sheet.pageCount,
      });
    }

    if (sheet.studentId === null) {
      return {
        printedSheetId: sheet.printedSheetId,
        studentId: null,
        confidence: 0,
        evidence: { motivo: 'hoja_de_reserva', qr: raw },
        needsHumanConfirmation: true,
        batchRejection: null,
      };
    }

    return {
      printedSheetId: sheet.printedSheetId,
      studentId: sheet.studentId,
      confidence: 1,
      evidence: { qr: raw, alumno: this.buildStudentName(sheet) },
      needsHumanConfirmation: false,
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
          studentId: printedSheets.studentId,
          specHash: sheetLayouts.specHash,
          spec: sheetLayouts.spec,
          studentFirstName: students.firstName,
          studentLastName: students.lastName,
        })
        .from(printedSheets)
        .innerJoin(sheetPrintRuns, eq(printedSheets.printRunId, sheetPrintRuns.id))
        .innerJoin(sheetLayouts, eq(sheetPrintRuns.layoutId, sheetLayouts.id))
        .leftJoin(students, eq(printedSheets.studentId, students.id))
        .where(and(eq(printedSheets.id, printedSheetId), eq(printedSheets.orgId, orgId)))
        .limit(1),
    );

    const row = rows[0];
    if (!row) return null;
    return {
      printedSheetId: row.printedSheetId,
      studentId: row.studentId,
      specHash: row.specHash,
      pageCount: row.spec.pageCount,
      studentFirstName: row.studentFirstName,
      studentLastName: row.studentLastName,
    };
  }

  private buildStudentName(sheet: PrintedSheetLookup): string {
    return [sheet.studentFirstName, sheet.studentLastName]
      .filter((part): part is string => part !== null && part.length > 0)
      .join(' ');
  }
}
