import Link from 'next/link';
import {
  PROCESS_COVERAGE_CELL_STATUS_LABELS,
  type ProcessCoverageCell,
  type ProcessCoverageCellStatus,
} from '@soe/types';
import { StatusBadge, type StatusTone } from '@/components/shared';
import { ROUTES } from '@/lib/routes';
import { cn } from '@/lib/utils';

const TONE_BY_STATUS: Record<ProcessCoverageCellStatus, StatusTone> = {
  complete: 'success',
  partial: 'warning',
  scheduled: 'info',
  missing: 'neutral',
};

const CELL_CLASS_BY_STATUS: Record<ProcessCoverageCellStatus, string> = {
  complete: 'bg-success/10 text-foreground',
  partial: 'bg-warning/15 text-foreground',
  scheduled: 'bg-info/10 text-foreground',
  missing: 'bg-muted/60 text-muted-foreground',
};

type MatrixRow = {
  classGroupId: string;
  classGroupName: string;
  gradeShortName: string;
  gradeOrder: number;
  cellsBySubject: Map<string, ProcessCoverageCell>;
};

export function CoverageMatrix({ cells }: { cells: readonly ProcessCoverageCell[] }) {
  const subjects = new Map<string, string>();
  const rows = new Map<string, MatrixRow>();

  for (const cell of cells) {
    subjects.set(cell.subjectId, cell.subjectShortName || cell.subjectName);
    let row = rows.get(cell.classGroupId);
    if (!row) {
      row = {
        classGroupId: cell.classGroupId,
        classGroupName: cell.classGroupName,
        gradeShortName: cell.gradeShortName,
        gradeOrder: cell.gradeOrder,
        cellsBySubject: new Map(),
      };
      rows.set(cell.classGroupId, row);
    }
    row.cellsBySubject.set(cell.subjectId, cell);
  }

  const subjectEntries = Array.from(subjects.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  const orderedRows = Array.from(rows.values()).sort(
    (a, b) => a.gradeOrder - b.gradeOrder || a.classGroupName.localeCompare(b.classGroupName),
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <th scope="col" className="text-muted-foreground px-2 text-left text-xs font-medium">
              Curso
            </th>
            {subjectEntries.map(([subjectId, label]) => (
              <th
                key={subjectId}
                scope="col"
                className="text-muted-foreground px-2 text-center text-xs font-medium"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orderedRows.map((row) => (
            <tr key={row.classGroupId}>
              <th scope="row" className="px-2 text-left font-medium whitespace-nowrap">
                {row.gradeShortName} {row.classGroupName}
              </th>
              {subjectEntries.map(([subjectId]) => {
                const cell = row.cellsBySubject.get(subjectId);
                if (!cell) return <td key={subjectId} className="p-0" />;
                return (
                  <td key={subjectId} className="p-0">
                    <CoverageCell cell={cell} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CoverageCell({ cell }: { cell: ProcessCoverageCell }) {
  const label = PROCESS_COVERAGE_CELL_STATUS_LABELS[cell.status];
  const counts =
    cell.studentsExpected > 0
      ? `${cell.studentsWithResults}/${cell.studentsExpected}`
      : `${cell.studentsWithResults}`;

  const content = (
    <span
      className={cn(
        'flex min-h-11 flex-col justify-center rounded-md px-2 py-1.5 text-center',
        CELL_CLASS_BY_STATUS[cell.status],
      )}
      title={`${label} — ${counts} alumnos con resultados`}
    >
      <span className="text-xs font-medium">{counts}</span>
      <span className="text-2xs">{label}</span>
    </span>
  );

  if (!cell.assessmentId) return content;
  return (
    <Link
      href={ROUTES.evaluacion(cell.assessmentId)}
      className="focus-visible:ring-ring block rounded-md focus-visible:ring-2 focus-visible:outline-none"
    >
      {content}
    </Link>
  );
}

export function CoverageLegend() {
  return (
    <ul className="flex flex-wrap gap-2">
      {(Object.keys(TONE_BY_STATUS) as ProcessCoverageCellStatus[]).map((status) => (
        <li key={status}>
          <StatusBadge tone={TONE_BY_STATUS[status]}>
            {PROCESS_COVERAGE_CELL_STATUS_LABELS[status]}
          </StatusBadge>
        </li>
      ))}
    </ul>
  );
}
