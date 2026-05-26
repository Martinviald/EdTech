import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { canAccess, ITEM_BANK_ROLES } from '@soe/types';
import { DiaImportWizard } from './DiaImportWizard';

export default async function ImportarDiaPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  if (!canAccess(session.user.roles, ITEM_BANK_ROLES)) redirect('/dashboard');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Importar pauta DIA</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Sube el archivo JSON con la pauta oficial DIA. El sistema parseará los ítems,
          los asociará a la taxonomía y creará el instrumento automáticamente.
        </p>
      </div>
      <DiaImportWizard />
    </div>
  );
}
