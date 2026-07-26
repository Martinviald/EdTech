import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import { canAccess, ITEM_BANK_ROLES, type InstrumentModel, type TaxonomyModel } from '@soe/types';
import { SetPageTitle } from '@/components/layout/page-title-context';
import { SpecTableWizard } from '../SpecTableWizard';

interface PageProps {
  params: Promise<{ instrumentId: string }>;
}

export default async function SpecTableUploadPage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect(ROUTES.login);
  if (!canAccess(session.user.roles, ITEM_BANK_ROLES)) redirect(ROUTES.dashboard);

  const { instrumentId } = await params;

  const [instrument, taxonomies] = await Promise.all([
    apiGet<InstrumentModel>(`/instruments/${instrumentId}`),
    apiGet<TaxonomyModel[]>('/taxonomies'),
  ]);

  // Los instrumentos OFICIALES del sistema sólo los edita platform_admin.
  if (instrument.isOfficial && !session.user.isPlatformAdmin) {
    redirect(ROUTES.bancoItemSpecTable(instrumentId));
  }

  return (
    <div className="space-y-6">
      <SetPageTitle
        title="Cargar tabla de especificaciones"
        parentHref={ROUTES.bancoItemSpecTable(instrumentId)}
        parentLabel={instrument.name}
      />
      <SpecTableWizard instrumentId={instrumentId} taxonomies={taxonomies} />
    </div>
  );
}
