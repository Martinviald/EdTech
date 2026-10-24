import type { AnswerSheetRowError, MarkReviewDecision, MarkState } from '@soe/types';
import type {
  ParsedAnswerSheetRow,
  ParserResult,
  PrescoredAnswer,
} from '../answer-sheets/lib/parsers/parser.types';

export interface ConfirmedScanMarkInput {
  printedNumber: string;
  state: MarkState;
  value: string | null;
  reviewedValue?: string | null;
  reviewDecision?: MarkReviewDecision | null;
  pendingReading?: true;
  prescored?: PrescoredAnswer;
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
    const pendingReadingLabels: string[] = [];
    const pendingReviewLabels: string[] = [];
    const prescoredAnswers: Record<string, PrescoredAnswer> = {};
    const errors: AnswerSheetRowError[] = [];

    for (const mark of scan.marks) {
      if (!seenColumns.has(mark.printedNumber)) {
        seenColumns.add(mark.printedNumber);
        detectedColumns.push(mark.printedNumber);
      }

      if (mark.prescored) {
        prescoredAnswers[mark.printedNumber] = mark.prescored;
        continue;
      }

      if (mark.pendingReading) {
        pendingReadingLabels.push(mark.printedNumber);
        continue;
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

      if (mark.state === 'multiple' || mark.state === 'ambiguous') {
        pendingReviewLabels.push(mark.printedNumber);
        errors.push(buildAmbiguousMarkError(scan.sequence, mark));
        continue;
      }

      answers[mark.printedNumber] = null;
    }

    rows.push({
      rowNumber: scan.sequence,
      studentRut: scan.studentRut,
      studentFullName: scan.studentFullName,
      answers,
      ...(annulledLabels.length > 0 ? { annulledLabels } : {}),
      ...(pendingReadingLabels.length > 0 ? { pendingReadingLabels } : {}),
      ...(pendingReviewLabels.length > 0 ? { pendingReviewLabels } : {}),
      ...(Object.keys(prescoredAnswers).length > 0 ? { prescoredAnswers } : {}),
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
    message: `Marca ${kind} sin revisar en la pregunta ${mark.printedNumber}: quedó pendiente de revisión, sin puntaje`,
  };
}
