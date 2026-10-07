import { Suspense, cache } from 'react';
import { Inbox, Layers } from 'lucide-react';
import type { OfficialEstablishmentReportResponse } from '@soe/types';
import { apiGet } from '@/lib/api';
import { getInstrumentSamples } from '@/lib/benchmark-samples';
import { EmptyState } from '@/components/shared/EmptyState';
import { TableSkeleton } from '@/components/shared/skeletons';
import { EstablishmentReport } from './establishment-report';
import { PrintToolbar } from './print-toolbar';

const getEstablishmentReport = cache((processId: string) =>
  apiGet<OfficialEstablishmentReportResponse>(
    `/reports/establishment?processId=${encodeURIComponent(processId)}`,
  ).catch((): OfficialEstablishmentReportResponse | null => null),
);

/**
 * Informe del establecimiento de un proceso de medición, con su barra de
 * impresión. Lo comparten el tab del proceso y `/establecimiento/informe-oficial`.
 */
export async function EstablishmentReportSection({
  processId,
  canSeeSample,
}: {
  processId: string;
  canSeeSample: boolean;
}) {
  const report = await getEstablishmentReport(processId);

  if (!report) {
    return (
      <EmptyState
        icon={Inbox}
        title="No se pudo generar el informe del establecimiento"
        description="El proceso no existe o no tienes acceso a él. Vuelve a elegir un proceso de medición."
      />
    );
  }

  if (report.subjects.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="El proceso todavía no tiene evaluaciones"
        description="Vincula al proceso las evaluaciones aplicadas para generar el informe del establecimiento."
      />
    );
  }

  if (!report.bandsAvailable) {
    return (
      <EmptyState
        icon={Layers}
        title="Este proceso no clasifica por niveles de logro"
        description="Ninguna evaluación del proceso usa un instrumento con niveles de logro definidos. El informe del establecimiento muestra la distribución por niveles, así que no aplica a este proceso."
      />
    );
  }

  return (
    <div className="space-y-4">
      <PrintToolbar />
      {canSeeSample ? (
        <Suspense fallback={<EstablishmentReport report={report} />}>
          <EstablishmentReportWithSamples report={report} />
        </Suspense>
      ) : (
        <EstablishmentReport report={report} />
      )}
    </div>
  );
}

async function EstablishmentReportWithSamples({
  report,
}: {
  report: OfficialEstablishmentReportResponse;
}) {
  const samples = await getInstrumentSamples(
    report.subjects.flatMap((subject) => subject.grades.map((grade) => grade.instrumentId)),
  );
  return <EstablishmentReport report={report} samples={samples} />;
}

export function EstablishmentReportSkeleton() {
  return (
    <div className="space-y-4">
      <TableSkeleton rows={6} />
      <TableSkeleton rows={6} />
    </div>
  );
}
