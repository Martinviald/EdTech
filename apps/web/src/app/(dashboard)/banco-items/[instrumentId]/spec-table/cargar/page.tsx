import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import { ROUTES } from '@/lib/routes';
import {
  canAccess,
  ITEM_BANK_ROLES,
  type InstrumentModel,
  type TaxonomyModel,
} from '@soe/types';
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
      <div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Link href={ROUTES.bancoItems} className="hover:text-foreground">
            Banco de Instrumentos
          </Link>
          <span>/</span>
          <Link
            href={ROUTES.bancoItem(instrumentId)}
            className="hover:text-foreground"
          >
            {instrument.name}
          </Link>
          <span>/</span>
          <Link
            href={ROUTES.bancoItemSpecTable(instrumentId)}
            className="hover:text-foreground"
          >
            Tabla de especificaciones
          </Link>
          <span>/</span>
          <span>Cargar</span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold">Cargar tabla de especificaciones</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sube un archivo Excel o CSV con la tabla de especificaciones del instrumento.
          Mapea las columnas y vincula los ítems automáticamente.
        </p>
      </div>
      <SpecTableWizard instrumentId={instrumentId} taxonomies={taxonomies} />
    </div>
  );
}
