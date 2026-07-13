import { redirect } from 'next/navigation';
import { Inbox } from 'lucide-react';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  ESTABLISHMENT_REPORT_ROLES,
  type OfficialEstablishmentReportResponse,
  type DashboardFilterOptionsResponse,
} from '@soe/types';
import { PageContainer, PageHeader, EmptyState } from '@/components/patterns';
import { EstablishmentReport } from '@/components/official-reports/establishment-report';
import { EstablishmentReportFilters } from '@/components/official-reports/establishment-report-filters';
import { PrintToolbar } from '@/components/official-reports/print-toolbar';

export const dynamic = 'force-dynamic';

function pickParam(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : undefined;
}

/**
 * TKT-25 — Informe oficial de establecimiento (Área Académica). Formato agregado
 * por grado × asignatura para toda la organización (Tablas 1.1–1.9). Sólo para
 * roles directivos (`ESTABLISHMENT_REPORT_ROLES`); el `org_id` sale del token.
 *
 * El Área Socioemocional queda fuera de alcance (la plataforma no ingesta ese
 * cuestionario) — documentado en TKT-25.
 */
export default async function InformeEstablecimientoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, ESTABLISHMENT_REPORT_ROLES)) redirect('/dashboard');

  const sp = await searchParams;
  const academicYearId = pickParam(sp.academicYearId);
  const period = pickParam(sp.period);
  const basePath = '/establecimiento/informe-oficial';

  const reportQuery = new URLSearchParams();
  if (academicYearId) reportQuery.set('academicYearId', academicYearId);
  if (period) reportQuery.set('period', period);
  const reportQs = reportQuery.toString();

  const [options, report] = await Promise.all([
    apiGet<DashboardFilterOptionsResponse>('/dashboards/filters').catch(
      (): DashboardFilterOptionsResponse | null => null,
    ),
    apiGet<OfficialEstablishmentReportResponse>(
      `/reports/establishment${reportQs ? `?${reportQs}` : ''}`,
    ).catch((): OfficialEstablishmentReportResponse | null => null),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="Informe oficial de establecimiento"
        description="Resultados agregados por grado y asignatura de toda la organización (Área Académica)."
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {options ? (
          <EstablishmentReportFilters
            academicYears={options.periods}
            value={{ academicYearId }}
            basePath={basePath}
          />
        ) : (
          <div />
        )}
        {report ? <PrintToolbar /> : null}
      </div>

      {report ? (
        <EstablishmentReport report={report} />
      ) : (
        <EmptyState
          icon={Inbox}
          title="No se pudo generar el informe de establecimiento"
          description="No hay resultados agregados para el año seleccionado, o no tienes acceso. Verifica que existan evaluaciones con resultados calculados."
        />
      )}
    </PageContainer>
  );
}
