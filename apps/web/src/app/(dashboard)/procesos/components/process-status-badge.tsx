import { StatusBadge, type StatusTone } from '@/components/shared';
import { PROCESS_STATUS_LABELS, type ProcessStatus } from '@soe/types';

const TONE_BY_STATUS: Record<ProcessStatus, StatusTone> = {
  planned: 'neutral',
  in_progress: 'info',
  loading: 'warning',
  closed: 'success',
  archived: 'neutral',
};

export function ProcessStatusBadge({ status }: { status: ProcessStatus }) {
  return <StatusBadge tone={TONE_BY_STATUS[status]}>{PROCESS_STATUS_LABELS[status]}</StatusBadge>;
}
