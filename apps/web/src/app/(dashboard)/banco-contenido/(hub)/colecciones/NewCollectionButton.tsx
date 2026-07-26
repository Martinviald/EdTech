'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/shared';
import { ROUTES } from '@/lib/routes';
import { createCollection } from '../../colecciones/actions';

const textareaClass =
  'flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

export function NewCollectionButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  function handleCreate() {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      toast.error('El nombre de la lista debe tener al menos 2 caracteres');
      return;
    }
    startTransition(async () => {
      const result = await createCollection({
        name: trimmed,
        description: description.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success('Lista creada');
      setOpen(false);
      setName('');
      setDescription('');
      router.push(ROUTES.bancoColeccion(result.data.id));
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          Nueva lista
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva lista</DialogTitle>
          <DialogDescription>
            Agrupa ítems para reutilizarlos y armar evaluaciones más rápido.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field label="Nombre" htmlFor="new-collection-name" required>
            <Input
              id="new-collection-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ej: Fracciones 5° básico"
              maxLength={200}
            />
          </Field>
          <Field label="Descripción" htmlFor="new-collection-description">
            <textarea
              id="new-collection-description"
              className={textareaClass}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Opcional"
              maxLength={1000}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleCreate} disabled={pending}>
            {pending ? 'Creando...' : 'Crear lista'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
