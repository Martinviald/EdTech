'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Trash2 } from 'lucide-react';
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
import { ROUTES } from '@/lib/routes';
import { deleteProcess } from '../../actions';

export function DeleteProcessDialog({
  processId,
  processName,
  assessmentCount,
}: {
  processId: string;
  processName: string;
  assessmentCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteProcess(processId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(
        result.data.unlinked > 0
          ? `Proceso eliminado. ${result.data.unlinked} evaluación(es) quedaron sin proceso.`
          : 'Proceso eliminado.',
      );
      setOpen(false);
      router.push(ROUTES.procesos);
      router.refresh();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Trash2 className="mr-2 size-4" aria-hidden />
          Eliminar
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar «{processName}»?</AlertDialogTitle>
          <AlertDialogDescription>
            {assessmentCount > 0
              ? `Sus ${assessmentCount} evaluación(es) NO se borran: quedan sin proceso y puedes volver a asociarlas.`
              : 'El proceso no tiene evaluaciones asociadas.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete} disabled={pending}>
            {pending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
            Eliminar proceso
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
