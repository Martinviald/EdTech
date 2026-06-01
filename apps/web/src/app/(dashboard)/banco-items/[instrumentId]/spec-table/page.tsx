import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { apiGet } from '@/lib/api';
import {
  canAccess,
  ITEM_BANK_ROLES,
  type InstrumentModel,
  type TaxonomyModel,
} from '@soe/types';
import { SpecTableWizard } from './SpecTableWizard';

interface PageProps {
  params: Promise<{ instrumentId: string }>;
}

export default async function SpecTablePage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, ITEM_BANK_ROLES)) redirect('/dashboard');

  const { instrumentId } = await params;

  const [instrument, taxonomies] = await Promise.all([
    apiGet<InstrumentModel>(`/instruments/${instrumentId}`),
    apiGet<TaxonomyModel[]>('/taxonomies'),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href={'/banco-items' as Route} className="hover:text-foreground">
            Banco de Items
          </Link>
          <span>/</span>
          <Link
            href={`/banco-items/${instrumentId}` as Route}
            className="hover:text-foreground"
          >
            {instrument.name}
          </Link>
          <span>/</span>
          <span>Tabla de especificaciones</span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold">Tabla de especificaciones</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Sube un archivo Excel o CSV con la tabla de especificaciones del instrumento.
          Mapea las columnas y vincula los items automaticamente.
        </p>
      </div>
      <SpecTableWizard instrumentId={instrumentId} taxonomies={taxonomies} />
    </div>
  );
}
