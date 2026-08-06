import {
  INSTRUMENT_APPLICATION_PERIODS,
  METRIC_KEYS,
  type InstrumentApplicationPeriod,
  type MasterBoardTake,
  type MetricKey,
} from '@soe/types';

export type MasterBoardFilterValues = {
  academicYearId?: string;
  instrumentType?: string;
  applicationPeriod?: InstrumentApplicationPeriod;
  assessmentId?: string[];
  gradeId?: string[];
  subjectId?: string[];
  metric?: MetricKey;
};

function firstString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function csvValue(value: string | string[] | undefined): string[] | undefined {
  const raw = firstString(value);
  if (!raw) return undefined;
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

export function parseMasterBoardFilters(
  params: Record<string, string | string[] | undefined>,
): MasterBoardFilterValues {
  const period = firstString(params.applicationPeriod);
  const metric = firstString(params.metric);
  return {
    academicYearId: firstString(params.academicYearId),
    instrumentType: firstString(params.instrumentType),
    applicationPeriod: INSTRUMENT_APPLICATION_PERIODS.includes(
      period as InstrumentApplicationPeriod,
    )
      ? (period as InstrumentApplicationPeriod)
      : undefined,
    assessmentId: csvValue(params.assessmentId),
    gradeId: csvValue(params.gradeId),
    subjectId: csvValue(params.subjectId),
    metric: METRIC_KEYS.includes(metric as MetricKey) ? (metric as MetricKey) : undefined,
  };
}

export function buildMasterBoardQuery(values: MasterBoardFilterValues): string {
  const params = new URLSearchParams();
  if (values.academicYearId) params.set('academicYearId', values.academicYearId);
  if (values.instrumentType) params.set('instrumentType', values.instrumentType);
  if (values.applicationPeriod) params.set('applicationPeriod', values.applicationPeriod);
  if (values.assessmentId?.length) params.set('assessmentId', values.assessmentId.join(','));
  if (values.gradeId?.length) params.set('gradeId', values.gradeId.join(','));
  if (values.subjectId?.length) params.set('subjectId', values.subjectId.join(','));
  if (values.metric) params.set('metric', values.metric);
  const queryString = params.toString();
  return queryString ? `?${queryString}` : '';
}

export function hasSelectedTake(values: MasterBoardFilterValues): boolean {
  return (!!values.academicYearId && !!values.instrumentType) || !!values.assessmentId?.length;
}

export function takeKeyOf(values: MasterBoardFilterValues): string | null {
  if (values.assessmentId?.length) return 'custom';
  if (values.academicYearId && values.instrumentType) {
    return `${values.academicYearId}:${values.instrumentType}:${values.applicationPeriod ?? '_'}`;
  }
  return null;
}

export function takeToFilterValues(
  take: MasterBoardTake,
  metric: MetricKey | undefined,
): MasterBoardFilterValues {
  return {
    academicYearId: take.academicYearId,
    instrumentType: take.instrumentType,
    applicationPeriod: take.applicationPeriod ?? undefined,
    metric,
  };
}
