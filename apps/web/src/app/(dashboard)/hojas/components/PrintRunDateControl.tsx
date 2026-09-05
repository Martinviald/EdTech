'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Loader2 } from 'lucide-react';
import { toSheetDateInput } from '@soe/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { updatePrintRunAdministeredAt } from '../actions';

/**
 * Fija o corrige la fecha de aplicación de una tirada ya creada, sin salir de la
 * pantalla de impresión. Escribe `assessments.administered_at` de la evaluación
 * asociada — es la fecha que se imprime en la cabecera de la hoja, así que se
 * puede ajustar y volver a descargar el PDF.
 */
export function PrintRunDateControl({
  runId,
  administeredAt,
  disabled = false,
}: {
  runId: string;
  administeredAt: string | Date | null;
  disabled?: boolean;
}) {
  const initial = toSheetDateInput(administeredAt);
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSave() {
    startTransition(async () => {
      const result = await updatePrintRunAdministeredAt(runId, value === '' ? null : value);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success('Fecha de aplicación actualizada. Vuelve a descargar el PDF para imprimirla.');
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        type="date"
        className="h-8 w-36"
        aria-label="Fecha de aplicación de la tirada"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled || pending}
      />
      {value !== initial ? (
        <Button
          size="sm"
          variant="outline"
          onClick={handleSave}
          disabled={pending}
          aria-label="Guardar fecha de aplicación"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        </Button>
      ) : null}
    </div>
  );
}
