export type ExpectedScopeCell = {
  classGroupId: string;
  subjectId: string;
};

export type ExpectedScope = {
  classGroupIds?: string[];
  subjectIds?: string[];
  excludedCells?: ExpectedScopeCell[];
  derived?: boolean;
};

export function expectedCellKey(cell: ExpectedScopeCell): string {
  return `${cell.classGroupId}:${cell.subjectId}`;
}

export function isExpectedScopeDefined(scope: ExpectedScope | null | undefined): boolean {
  if (!scope) return false;
  return (scope.classGroupIds?.length ?? 0) > 0 && (scope.subjectIds?.length ?? 0) > 0;
}

export function expandExpectedCells(scope: ExpectedScope | null | undefined): ExpectedScopeCell[] {
  if (!isExpectedScopeDefined(scope)) return [];

  const excluded = new Set((scope!.excludedCells ?? []).map(expectedCellKey));
  const classGroupIds = dedupe(scope!.classGroupIds!);
  const subjectIds = dedupe(scope!.subjectIds!);

  const cells: ExpectedScopeCell[] = [];
  for (const classGroupId of classGroupIds) {
    for (const subjectId of subjectIds) {
      const cell = { classGroupId, subjectId };
      if (excluded.has(expectedCellKey(cell))) continue;
      cells.push(cell);
    }
  }
  return cells;
}

export function countExpectedCells(scope: ExpectedScope | null | undefined): number {
  return expandExpectedCells(scope).length;
}

function dedupe(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}
