import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import {
  ANSWER_SHEET_IMPORT_ROLES,
  ANSWER_SHEET_FORMATS,
  canAccess,
  type AnswerSheetFormat,
  type InstrumentModel,
} from '@soe/types';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { PageContainer, PageHeader, CardSkeleton } from '@/components/shared';
import { ROUTES } from '@/lib/routes';
import { UploadForm } from '../components/upload-form';

type InstrumentsListResponse = {
  data: InstrumentModel[];
  total: number;
};

type SearchParams = Promise<{ format?: string }>;

function isAnswerSheetFormat(value: string | undefined): value is AnswerSheetFormat {
  return typeof value === 'string'
    && (ANSWER_SHEET_FORMATS as readonly string[]).includes(value);
}

async function fetchInstruments(): Promise<InstrumentModel[]> {
  try {
    const result = await apiGet<InstrumentsListResponse | InstrumentModel[]>(
      '/dia-ingestion/instruments',
    );
    if (Array.isArray(result)) return result;
    return result.data ?? [];
  } catch {
    return [];
  }
}

export default async function CargarPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (!session?.user?.orgId) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, ANSWER_SHEET_IMPORT_ROLES)) {
    redirect(ROUTES.dashboard);
  }

  const params = await searchParams;
  const defaultFormat = isAnswerSheetFormat(params.format) ? params.format : null;

  return (
    <PageContainer>
      <PageHeader
        title="Cargar archivo de respuestas"
        description="Sube el archivo con las respuestas de los alumnos. El sistema lo analizará y te mostrará una previsualización antes de guardarlo."
      />

      <Suspense fallback={<CardSkeleton rows={4} />}>
        <UploadFormSection defaultFormat={defaultFormat} />
      </Suspense>
    </PageContainer>
  );
}

async function UploadFormSection({ defaultFormat }: { defaultFormat: AnswerSheetFormat | null }) {
  const instruments = await fetchInstruments();

  return <UploadForm defaultFormat={defaultFormat} instruments={instruments} />;
}
