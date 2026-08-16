'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { PenSquare } from 'lucide-react';
import { ROUTES } from '@/lib/routes';
import { Button } from '@/components/ui/button';
import { createPrintableMaterial } from './document-actions';

/**
 * Crea un documento imprimible desde el instrumento y navega al Editor de
 * Materiales. Sólo se renderiza para usuarios con `DOCUMENT_EDITOR_ROLES`
 * (boolean resuelto en la página server, no acá).
 */
export function CreateMaterialButton({ instrumentId }: { instrumentId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await createPrintableMaterial(instrumentId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success('Material abierto en el editor');
      router.push(ROUTES.material(result.data.id));
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={isPending}>
      <PenSquare className="size-4" aria-hidden />
      {isPending ? 'Creando…' : 'Crear material imprimible'}
    </Button>
  );
}
