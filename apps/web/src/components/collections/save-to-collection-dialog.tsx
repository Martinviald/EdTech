'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ItemCollectionListResponse, ItemCollectionModel } from '@soe/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Field } from '@/components/shared';
import { apiClientGet } from '@/lib/api-client';
import {
  addItemsToCollection,
  createCollectionWithItems,
} from '@/app/(dashboard)/banco-contenido/colecciones/actions';

type Mode = 'existing' | 'new';

export const itemCollectionKeys = {
  list: ['item-collections', 'list'] as const,
};

const textareaClass =
  'flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

interface SaveToCollectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemIds: string[];
  /** Colecciones iniciales (fallback mientras el diálogo trae las frescas). */
  collections?: ItemCollectionModel[];
  onSaved: () => void;
}

export function SaveToCollectionDialog({
  open,
  onOpenChange,
  itemIds,
  collections: initialCollections = [],
  onSaved,
}: SaveToCollectionDialogProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, startTransition] = useTransition();

  const { data } = useQuery({
    queryKey: itemCollectionKeys.list,
    queryFn: () => apiClientGet<ItemCollectionListResponse>('/item-collections?limit=100'),
    enabled: open,
  });
  const collections = data?.data ?? initialCollections;
  const hasCollections = collections.length > 0;

  const [mode, setMode] = useState<Mode>('existing');
  const [collectionId, setCollectionId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (open) setMode(hasCollections ? 'existing' : 'new');
  }, [open, hasCollections]);

  function reset() {
    setName('');
    setDescription('');
    setCollectionId('');
  }

  function finish() {
    void queryClient.invalidateQueries({ queryKey: itemCollectionKeys.list });
    onOpenChange(false);
    onSaved();
    reset();
    router.refresh();
  }

  function handleSave() {
    if (mode === 'existing') {
      if (!collectionId) {
        toast.error('Elige una colección de destino');
        return;
      }
      startTransition(async () => {
        const result = await addItemsToCollection(collectionId, itemIds);
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        toast.success(`${itemIds.length} ítem(s) guardados en la lista`);
        finish();
      });
      return;
    }

    const trimmed = name.trim();
    if (trimmed.length < 2) {
      toast.error('El nombre de la lista debe tener al menos 2 caracteres');
      return;
    }
    startTransition(async () => {
      const result = await createCollectionWithItems(
        { name: trimmed, description: description.trim() || undefined },
        itemIds,
      );
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(`Lista «${trimmed}» creada con ${itemIds.length} ítem(s)`);
      finish();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Guardar en lista</DialogTitle>
          <DialogDescription>
            {itemIds.length} ítem{itemIds.length === 1 ? '' : 's'} seleccionado
            {itemIds.length === 1 ? '' : 's'}. Agrégalos a una lista existente o crea una nueva.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {hasCollections && (
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === 'existing' ? 'default' : 'outline'}
                onClick={() => setMode('existing')}
              >
                Lista existente
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === 'new' ? 'default' : 'outline'}
                onClick={() => setMode('new')}
              >
                Nueva lista
              </Button>
            </div>
          )}

          {mode === 'existing' ? (
            <Field label="Lista de destino" htmlFor="collection-select" required>
              <Select value={collectionId} onValueChange={setCollectionId}>
                <SelectTrigger id="collection-select">
                  <SelectValue placeholder="Selecciona una lista" />
                </SelectTrigger>
                <SelectContent>
                  {collections.map((collection) => (
                    <SelectItem key={collection.id} value={collection.id}>
                      {collection.name} ({collection.itemCount})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <>
              <Field label="Nombre de la lista" htmlFor="collection-name" required>
                <Input
                  id="collection-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Ej: Fracciones 5° básico"
                  maxLength={200}
                />
              </Field>
              <Field label="Descripción" htmlFor="collection-description">
                <textarea
                  id="collection-description"
                  className={textareaClass}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Opcional"
                  maxLength={1000}
                />
              </Field>
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSave} disabled={pending}>
            {pending ? 'Guardando...' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
