'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, PenLine } from 'lucide-react';
import type { InstrumentModel } from '@soe/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Field } from '@/components/shared';
import { HOJAS_ROUTES } from '../lib/routes';

export type InstrumentOption = Pick<InstrumentModel, 'id' | 'name' | 'year' | 'type'>;

export function DesignSheetDialog({ instruments }: { instruments: InstrumentOption[] }) {
  const [open, setOpen] = useState(false);
  const [instrumentId, setInstrumentId] = useState('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    if (!instrumentId) {
      toast.error('Selecciona un instrumento para diseñar su hoja');
      return;
    }
    startTransition(() => {
      router.push(HOJAS_ROUTES.disenar(instrumentId));
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <PenLine className="mr-2 size-4" />
          Diseñar hoja
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleContinue} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Diseñar hoja de respuesta</DialogTitle>
            <DialogDescription>
              Elige el instrumento: sus preguntas definen las burbujas de la hoja. Podrás revisar
              la propuesta antes de congelarla.
            </DialogDescription>
          </DialogHeader>

          <Field label="Instrumento" htmlFor="sheet-instrument" required>
            <Select value={instrumentId} onValueChange={setInstrumentId} disabled={pending}>
              <SelectTrigger id="sheet-instrument">
                <SelectValue placeholder="Selecciona un instrumento" />
              </SelectTrigger>
              <SelectContent>
                {instruments.map((instrument) => (
                  <SelectItem key={instrument.id} value={instrument.id}>
                    {instrument.name}
                    {instrument.year ? ` · ${instrument.year}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || !instrumentId}>
              {pending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Abriendo…
                </>
              ) : (
                'Continuar'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
