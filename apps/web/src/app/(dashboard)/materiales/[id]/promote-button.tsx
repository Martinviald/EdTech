'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ClipboardCheck, ExternalLink } from 'lucide-react';
import type { Route } from 'next';
import type { DocumentModel } from '@soe/types';
import { ROUTES } from '@/lib/routes';
import { apiClientPost } from '@/lib/api-client';
import { getDisplayMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

type PromoteButtonProps = {
  documentId: string;
  instrumentId: string | null;
  hasItems: boolean;
  onPromoted: (document: DocumentModel) => void;
};

/**
 * Promoción opt-in a instrumento (Decisión G2): habilita aplicar y medir el
 * material por el backbone instruments → assessments → resultados. Una guía de
 * trabajo nunca necesita esto; su especificación derivada ya orienta.
 */
export function PromoteButton({
  documentId,
  instrumentId,
  hasItems,
  onPromoted,
}: PromoteButtonProps) {
  const [isPromoting, setIsPromoting] = useState(false);

  if (instrumentId) {
    return (
      <Button asChild type="button" variant="outline" size="sm" icon={ExternalLink}>
        <Link href={ROUTES.bancoItem(instrumentId) as Route}>Ver instrumento vinculado</Link>
      </Button>
    );
  }
  if (!hasItems) return null;

  async function promote() {
    setIsPromoting(true);
    try {
      const updated = await apiClientPost<DocumentModel>(
        `/documents/${documentId}/promote-to-instrument`,
        {},
      );
      toast.success('Material listo para aplicar: se creó su instrumento en el banco.');
      onPromoted(updated);
    } catch (error) {
      toast.error(getDisplayMessage(error, 'No se pudo preparar el material para aplicar'));
    } finally {
      setIsPromoting(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" icon={ClipboardCheck} disabled={isPromoting}>
          {isPromoting ? 'Preparando…' : 'Preparar para aplicar'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Preparar este material para aplicar?</AlertDialogTitle>
          <AlertDialogDescription>
            Se creará un instrumento en el banco de contenido con las preguntas del material, en
            su orden actual. Así podrás aplicarlo, corregirlo y ver sus resultados en los
            dashboards. El material seguirá siendo editable.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => void promote()}>Preparar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
