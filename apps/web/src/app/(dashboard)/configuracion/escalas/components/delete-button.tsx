'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
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
import { Button } from '@/components/ui/button';
import { deleteGradingScaleAction } from '../actions';

function isInUseError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('en uso') ||
    m.includes('in use') ||
    m.includes('conflict') ||
    m.includes('foreign key') ||
    m.includes('referenc')
  );
}

export function DeleteButton({ scaleId, scaleName }: { scaleId: string; scaleName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      try {
        await deleteGradingScaleAction(scaleId);
        toast.success('Escala eliminada');
        setOpen(false);
        router.push('/configuracion/escalas' as Route);
        router.refresh();
      } catch (err) {
        const raw = err instanceof Error ? err.message : 'No se pudo eliminar la escala.';
        if (isInUseError(raw)) {
          setError(
            'No se puede eliminar: la escala está siendo usada por uno o más instrumentos. ' +
              'Reasigna esos instrumentos a otra escala antes de borrarla.',
          );
        } else {
          setError(raw);
        }
      }
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="outline" className="text-destructive hover:text-destructive">
          <Trash2 className="mr-2 size-4" />
          Eliminar escala
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar “{scaleName}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción no se puede deshacer. La escala se borrará permanentemente. Si está siendo
            usada por algún instrumento, primero deberás reasignar esos instrumentos a otra escala.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            disabled={pending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending ? 'Eliminando…' : 'Eliminar'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
