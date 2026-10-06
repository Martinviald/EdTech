export type ProcessCandidate = {
  assessmentId: string;
  orgId: string;
  academicYearId: string;
  instrumentId: string;
  instrumentType: string;
  applicationPeriod: string | null;
  gradeId: string;
  subjectId: string | null;
  trackId: string | null;
};

export type ProcessTestKey<T extends ProcessCandidate = ProcessCandidate> = (
  candidate: T,
) => string | null;

export const subjectTestKey: ProcessTestKey = (candidate) => candidate.subjectId;

export const trackOrSubjectTestKey: ProcessTestKey = (candidate) =>
  candidate.trackId ? `track:${candidate.trackId}` : candidate.subjectId;

const NO_TEST_KEY = '∅';

export type ProcessInvariantViolation = {
  gradeId: string;
  testKey: string | null;
  instrumentIds: string[];
  assessmentIds: string[];
};

export type ProcessCandidateGroup<T extends ProcessCandidate = ProcessCandidate> = {
  key: string;
  orgId: string;
  academicYearId: string;
  instrumentType: string;
  applicationPeriod: string | null;
  candidates: T[];
  assessmentIds: string[];
};

export type AmbiguousProcessCandidateGroup<T extends ProcessCandidate = ProcessCandidate> =
  ProcessCandidateGroup<T> & { violations: ProcessInvariantViolation[] };

export type ProcessCandidateGrouping<T extends ProcessCandidate = ProcessCandidate> = {
  groups: ProcessCandidateGroup<T>[];
  ambiguous: AmbiguousProcessCandidateGroup<T>[];
  multiYearAssessmentIds: string[];
};

export function processGroupKey(candidate: ProcessCandidate): string {
  return [
    candidate.orgId,
    candidate.academicYearId,
    candidate.instrumentType,
    candidate.applicationPeriod ?? 'sin-momento',
  ].join('|');
}

export function findProcessInvariantViolations<T extends ProcessCandidate>(
  candidates: readonly T[],
  testKey: ProcessTestKey<T> = trackOrSubjectTestKey as ProcessTestKey<T>,
): ProcessInvariantViolation[] {
  const cells = new Map<
    string,
    { gradeId: string; testKey: string | null; instruments: Set<string>; assessments: Set<string> }
  >();
  for (const candidate of candidates) {
    const key = testKey(candidate);
    const cellKey = `${candidate.gradeId}|${key ?? NO_TEST_KEY}`;
    let cell = cells.get(cellKey);
    if (!cell) {
      cell = {
        gradeId: candidate.gradeId,
        testKey: key,
        instruments: new Set(),
        assessments: new Set(),
      };
      cells.set(cellKey, cell);
    }
    cell.instruments.add(candidate.instrumentId);
    cell.assessments.add(candidate.assessmentId);
  }

  const violations: ProcessInvariantViolation[] = [];
  for (const cell of cells.values()) {
    if (cell.instruments.size < 2) continue;
    violations.push({
      gradeId: cell.gradeId,
      testKey: cell.testKey,
      instrumentIds: Array.from(cell.instruments).sort(),
      assessmentIds: Array.from(cell.assessments).sort(),
    });
  }
  return violations;
}

export function groupProcessCandidates<T extends ProcessCandidate>(
  candidates: readonly T[],
  options: { testKey?: ProcessTestKey<T> } = {},
): ProcessCandidateGrouping<T> {
  const testKey = options.testKey ?? (trackOrSubjectTestKey as ProcessTestKey<T>);

  const yearsByAssessment = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    let years = yearsByAssessment.get(candidate.assessmentId);
    if (!years) {
      years = new Set();
      yearsByAssessment.set(candidate.assessmentId, years);
    }
    years.add(candidate.academicYearId);
  }
  const multiYearAssessmentIds: string[] = [];
  for (const [assessmentId, years] of yearsByAssessment) {
    if (years.size > 1) multiYearAssessmentIds.push(assessmentId);
  }
  const excluded = new Set(multiYearAssessmentIds);

  const byKey = new Map<string, { group: ProcessCandidateGroup<T>; assessments: Set<string> }>();
  for (const candidate of candidates) {
    if (excluded.has(candidate.assessmentId)) continue;
    const key = processGroupKey(candidate);
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        group: {
          key,
          orgId: candidate.orgId,
          academicYearId: candidate.academicYearId,
          instrumentType: candidate.instrumentType,
          applicationPeriod: candidate.applicationPeriod,
          candidates: [],
          assessmentIds: [],
        },
        assessments: new Set(),
      };
      byKey.set(key, entry);
    }
    entry.group.candidates.push(candidate);
    if (!entry.assessments.has(candidate.assessmentId)) {
      entry.assessments.add(candidate.assessmentId);
      entry.group.assessmentIds.push(candidate.assessmentId);
    }
  }

  const groups: ProcessCandidateGroup<T>[] = [];
  const ambiguous: AmbiguousProcessCandidateGroup<T>[] = [];
  for (const { group } of byKey.values()) {
    const violations = findProcessInvariantViolations(group.candidates, testKey);
    if (violations.length === 0) {
      groups.push(group);
      continue;
    }
    const conflicting = new Set(violations.flatMap((violation) => violation.assessmentIds));
    const assignable = subsetOfGroup(group, (id) => !conflicting.has(id));
    if (assignable.assessmentIds.length > 0) groups.push(assignable);
    ambiguous.push({ ...subsetOfGroup(group, (id) => conflicting.has(id)), violations });
  }

  return { groups, ambiguous, multiYearAssessmentIds };
}

function subsetOfGroup<T extends ProcessCandidate>(
  group: ProcessCandidateGroup<T>,
  keep: (assessmentId: string) => boolean,
): ProcessCandidateGroup<T> {
  return {
    ...group,
    candidates: group.candidates.filter((candidate) => keep(candidate.assessmentId)),
    assessmentIds: group.assessmentIds.filter(keep),
  };
}
