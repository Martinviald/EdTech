import { redirect } from 'next/navigation';
import { ROUTES } from '@/lib/routes';

// Compatibilidad: la importación de pauta se unificó bajo el hub /importar.
export default function ImportarDiaRedirect() {
  redirect(ROUTES.importarInstrumento);
}
