import type { AnswerSheetRowError, MarkReviewDecision, MarkState } from '@soe/types';
import type { ParsedAnswerSheetRow, ParserResult } from '../answer-sheets/lib/parsers/parser.types';

export interface ConfirmedScanMarkInput {
  printedNumber: string;
  state: MarkState;
  value: string | null;
  reviewedValue?: string | null;
  reviewDecision?: MarkReviewDecision | null;
}

export interface ConfirmedScanInput {
  sequence: number;
  studentRut: string | null;
  studentFullName: string | null;
  marks: ConfirmedScanMarkInput[];
}

export function toParserResult(scans: ConfirmedScanInput[]): ParserResult {
  const detectedColumns: string[] = [];
  const seenColumns = new Set<string>();
  const rows: ParsedAnswerSheetRow[] = [];

  for (const scan of scans) {
    const answers: Record<string, string | null> = {};
    const annulledLabels: string[] = [];
    const errors: AnswerSheetRowError[] = [];

    for (const mark of scan.marks) {
      if (!seenColumns.has(mark.printedNumber)) {
        seenColumns.add(mark.printedNumber);
        detectedColumns.push(mark.printedNumber);
      }

      if (mark.reviewedValue !== undefined) {
        answers[mark.printedNumber] = mark.reviewedValue;
        if (mark.reviewDecision === 'annulled') annulledLabels.push(mark.printedNumber);
        continue;
      }

      if (mark.state === 'marked') {
        answers[mark.printedNumber] = mark.value;
        continue;
      }

      answers[mark.printedNumber] = null;

      if (mark.state === 'multiple' || mark.state === 'ambiguous') {
        errors.push(buildAmbiguousMarkError(scan.sequence, mark));
      }
    }

    rows.push({
      rowNumber: scan.sequence,
      studentRut: scan.studentRut,
      studentFullName: scan.studentFullName,
      answers,
      annulledLabels,
      errors,
    });
  }

  return { rows, detectedColumns, warnings: [] };
}

function buildAmbiguousMarkError(
  rowNumber: number,
  mark: ConfirmedScanMarkInput,
): AnswerSheetRowError {
  const kind = mark.state === 'multiple' ? 'múltiple' : 'ambigua';
  return {
    rowNumber,
    field: mark.printedNumber,
    code: 'ambiguous_mark',
    message: `Marca ${kind} sin revisar en la pregunta ${mark.printedNumber}`,
  };
}
