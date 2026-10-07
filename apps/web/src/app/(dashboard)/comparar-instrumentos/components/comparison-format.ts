import {
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  type AssessmentComparisonCandidate,
} from '@soe/types';

export function formatDate(value: string | Date | null): string | null {
  if (!value) return null;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function candidateDetail(candidate: AssessmentComparisonCandidate): string {
  return [
    candidate.instrumentName,
    candidate.applicationPeriod
      ? INSTRUMENT_APPLICATION_PERIOD_LABELS[candidate.applicationPeriod]
      : null,
    candidate.academicYear ? String(candidate.academicYear) : null,
    formatDate(candidate.appliedAt),
  ]
    .filter(Boolean)
    .join(' · ');
}

export function formatPct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

export function formatDeltaPp(value: number | null): string {
  if (value === null) return '—';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)} pp`;
}
