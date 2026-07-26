import { redirect } from 'next/navigation';
import { ROUTES } from '@/lib/routes';

// Compatibilidad: la importación de resultados se unificó bajo el hub /importar.
export default function ImportarResultadosRedirect() {
  redirect(ROUTES.importarResultados);
}
