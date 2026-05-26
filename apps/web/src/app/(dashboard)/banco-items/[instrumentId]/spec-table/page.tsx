import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { canAccess, ITEM_BANK_ROLES } from '@soe/types';
import { SpecTableWizard } from './SpecTableWizard';

interface PageProps {
  params: Promise<{ instrumentId: string }>;
}

export default async function SpecTablePage({ params }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, ITEM_BANK_ROLES)) redirect('/dashboard');

  const { instrumentId } = await params;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Tabla de especificaciones</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Sube un archivo Excel o CSV con la tabla de especificaciones del instrumento.
          Mapea las columnas y vincula los items automaticamente.
        </p>
      </div>
      <SpecTableWizard instrumentId={instrumentId} />
    </div>
  );
}
