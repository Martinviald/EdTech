import {
  expandExpectedCells,
  expectedCellKey,
  isExpectedScopeDefined,
  type ExpectedScope,
  type ProcessCoverageCell,
  type ProcessCoverageCellStatus,
  type ProcessCoverageTotals,
} from '@soe/types';

export type CoverageAssessmentCell = {
  assessmentId: string;
  assessmentName: string | null;
  classGroupId: string;
  classGroupName: string;
  gradeShortName: string;
  gradeOrder: number;
  subjectId: string | null;
  subjectName: string | null;
  subjectShortName: string | null;
  studentsWithResults: number;
};

export type CoverageCatalog = {
  classGroups: Map<string, { name: string; gradeShortName: string; gradeOrder: number }>;
  subjects: Map<string, { name: string; shortName: string }>;
  studentsByClassGroup: Map<string, number>;
};

export type CoverageAssembly = {
  totals: ProcessCoverageTotals;
  cells: ProcessCoverageCell[];
  unexpectedCells: ProcessCoverageCell[];
};

const UNKNOWN_SUBJECT_ID = 'sin-asignatura';

export function resolveCellStatus(
  hasAssessment: boolean,
  studentsWithResults: number,
  studentsExpected: number,
): ProcessCoverageCellStatus {
  if (!hasAssessment) return 'missing';
  if (studentsWithResults === 0) return 'scheduled';
  if (studentsExpected > 0 && studentsWithResults < studentsExpected) return 'partial';
  return 'complete';
}

export function assembleCoverage(
  scope: ExpectedScope | null | undefined,
  actualCells: readonly CoverageAssessmentCell[],
  catalog: CoverageCatalog,
): CoverageAssembly {
  const actualByKey = new Map<string, CoverageAssessmentCell>();
  for (const cell of actualCells) {
    const key = expectedCellKey({
      classGroupId: cell.classGroupId,
      subjectId: cell.subjectId ?? UNKNOWN_SUBJECT_ID,
    });
    const existing = actualByKey.get(key);
    if (!existing) {
      actualByKey.set(key, { ...cell });
      continue;
    }
    existing.studentsWithResults += cell.studentsWithResults;
  }

  const cells: ProcessCoverageCell[] = [];
  const consumedKeys = new Set<string>();

  for (const expected of expandExpectedCells(scope)) {
    const key = expectedCellKey(expected);
    consumedKeys.add(key);
    const actual = actualByKey.get(key);
    const classGroup = catalog.classGroups.get(expected.classGroupId);
    const subject = catalog.subjects.get(expected.subjectId);
    const studentsExpected = catalog.studentsByClassGroup.get(expected.classGroupId) ?? 0;
    const studentsWithResults = actual?.studentsWithResults ?? 0;

    cells.push({
      classGroupId: expected.classGroupId,
      classGroupName: actual?.classGroupName ?? classGroup?.name ?? '—',
      gradeShortName: actual?.gradeShortName ?? classGroup?.gradeShortName ?? '',
      gradeOrder: actual?.gradeOrder ?? classGroup?.gradeOrder ?? 0,
      subjectId: expected.subjectId,
      subjectName: actual?.subjectName ?? subject?.name ?? '—',
      subjectShortName: actual?.subjectShortName ?? subject?.shortName ?? '',
      status: resolveCellStatus(Boolean(actual), studentsWithResults, studentsExpected),
      assessmentId: actual?.assessmentId ?? null,
      assessmentName: actual?.assessmentName ?? null,
      studentsExpected,
      studentsWithResults,
    });
  }

  const unexpectedCells: ProcessCoverageCell[] = [];
  for (const [key, actual] of actualByKey) {
    if (consumedKeys.has(key)) continue;
    const studentsExpected = catalog.studentsByClassGroup.get(actual.classGroupId) ?? 0;
    unexpectedCells.push({
      classGroupId: actual.classGroupId,
      classGroupName: actual.classGroupName,
      gradeShortName: actual.gradeShortName,
      gradeOrder: actual.gradeOrder,
      subjectId: actual.subjectId ?? UNKNOWN_SUBJECT_ID,
      subjectName: actual.subjectName ?? '—',
      subjectShortName: actual.subjectShortName ?? '',
      status: resolveCellStatus(true, actual.studentsWithResults, studentsExpected),
      assessmentId: actual.assessmentId,
      assessmentName: actual.assessmentName,
      studentsExpected,
      studentsWithResults: actual.studentsWithResults,
    });
  }

  return {
    totals: countTotals(cells, isExpectedScopeDefined(scope)),
    cells: cells.sort(compareCells),
    unexpectedCells: unexpectedCells.sort(compareCells),
  };
}

function countTotals(
  cells: readonly ProcessCoverageCell[],
  scopeDefined: boolean,
): ProcessCoverageTotals {
  const totals: ProcessCoverageTotals = {
    expected: scopeDefined ? cells.length : 0,
    missing: 0,
    scheduled: 0,
    partial: 0,
    complete: 0,
  };
  for (const cell of cells) totals[cell.status] += 1;
  return totals;
}

function compareCells(a: ProcessCoverageCell, b: ProcessCoverageCell): number {
  if (a.gradeOrder !== b.gradeOrder) return a.gradeOrder - b.gradeOrder;
  const byClassGroup = a.classGroupName.localeCompare(b.classGroupName);
  if (byClassGroup !== 0) return byClassGroup;
  return a.subjectName.localeCompare(b.subjectName);
}
