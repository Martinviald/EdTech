import { redirect } from 'next/navigation';

// Compatibilidad: la importación de pauta se unificó bajo el hub /importar.
export default function ImportarDiaRedirect() {
  redirect('/importar/instrumento');
}
