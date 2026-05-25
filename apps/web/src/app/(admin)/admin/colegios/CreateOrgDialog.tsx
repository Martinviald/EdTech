'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createOrganizationAction } from './actions';

export function CreateOrgDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createOrganizationAction(formData);
      if (result.ok) {
        toast.success('Colegio creado');
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 size-4" />
          Crear colegio
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo colegio</DialogTitle>
          <DialogDescription>
            Crea el registro. El school_admin completa el resto en /organizacion/configurar.
          </DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nombre</Label>
            <Input id="name" name="name" required minLength={2} maxLength={200} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rbd">RBD</Label>
            <Input
              id="rbd"
              name="rbd"
              required
              placeholder="12345-6"
              pattern="\d{1,5}-[0-9kK]"
            />
            <p className="text-xs text-muted-foreground">
              Formato oficial MINEDUC (números-dígito o k verificador).
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="commune">Comuna</Label>
              <Input id="commune" name="commune" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="region">Región</Label>
              <Input id="region" name="region" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dependence">Dependencia</Label>
            <Select name="dependence">
              <SelectTrigger id="dependence">
                <SelectValue placeholder="Seleccionar (opcional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="municipal">Municipal</SelectItem>
                <SelectItem value="particular_pagado">Particular pagado</SelectItem>
                <SelectItem value="particular_subvencionado">Particular subvencionado</SelectItem>
                <SelectItem value="delegada">Administración delegada</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Creando…' : 'Crear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
