import { redirect } from 'next/navigation';

// Compatibilidad: la importación de resultados se unificó bajo el hub /importar.
export default function ImportarResultadosRedirect() {
  redirect('/importar/resultados');
}
