'use client';

import { ITEM_TYPE_LABELS } from '@soe/types';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeft, FileStack, Trash2, X } from 'lucide-react';
import type { ItemCollectionDetailModel } from '@soe/types';
import { EmptyState, Field, PageHeader } from '@/components/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { ROUTES } from '@/lib/routes';
import { deleteCollection, materializeCollection, removeItemFromCollection } from '../actions';

function getContentPreview(content: Record<string, unknown>): string {
  for (const field of ['stem', 'text', 'prompt', 'question'] as const) {
    const value = content[field];
    if (typeof value === 'string' && value) return value;
  }
  return '(Sin contenido)';
}

interface CollectionDetailViewProps {
  collection: ItemCollectionDetailModel;
  canManage: boolean;
}

export function CollectionDetailView({ collection, canManage }: CollectionDetailViewProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [materializeOpen, setMaterializeOpen] = useState(false);
  const [instrumentName, setInstrumentName] = useState(collection.name);

  const items = collection.items;

  function handleRemove(itemId: string) {
    startTransition(async () => {
      const result = await removeItemFromCollection(collection.id, itemId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success('Ítem quitado de la lista');
      router.refresh();
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteCollection(collection.id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success('Lista eliminada');
      router.push(ROUTES.bancoColecciones);
    });
  }

  function handleMaterialize() {
    const name = instrumentName.trim();
    if (name.length < 2) {
      toast.error('El nombre de la evaluación debe tener al menos 2 caracteres');
      return;
    }
    startTransition(async () => {
      const result = await materializeCollection(collection.id, { name });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success('Evaluación creada a partir de la lista');
      setMaterializeOpen(false);
      router.push(ROUTES.bancoItem(result.data.id));
    });
  }

  return (
    <>
      <Link
        href={ROUTES.bancoColecciones}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Colecciones
      </Link>

      <PageHeader
        title={collection.name}
        description={collection.description ?? undefined}
        actions={
          canManage ? (
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => setMaterializeOpen(true)}
                disabled={items.length === 0 || pending}
              >
                <FileStack className="mr-1 h-4 w-4" />
                Crear evaluación
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline">
                    <Trash2 className="mr-1 h-4 w-4" />
                    Eliminar
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Eliminar esta lista?</AlertDialogTitle>
                    <AlertDialogDescription>
                      La lista «{collection.name}» se eliminará. Los ítems no se borran, solo se
                      deshace la agrupación.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete}>Eliminar</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ) : undefined
        }
      />

      <p className="text-sm text-muted-foreground">
        {items.length} ítem{items.length === 1 ? '' : 's'}
      </p>

      {items.length === 0 ? (
        <EmptyState
          icon={FileStack}
          title="Lista vacía"
          description="Agrega ítems desde la pestaña Ítems del banco: selecciónalos y usa «Guardar en lista»."
        />
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {items.map((entry, index) => (
            <li key={entry.id} className="flex items-start gap-3 p-3">
              <span className="mt-0.5 w-6 shrink-0 font-mono text-xs text-muted-foreground">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-sm">
                  {entry.item ? getContentPreview(entry.item.content) : 'Ítem no disponible'}
                </p>
                {entry.item && (
                  <span className="text-xs text-muted-foreground">
                    {ITEM_TYPE_LABELS[entry.item.type] ?? entry.item.type}
                  </span>
                )}
              </div>
              {canManage && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => handleRemove(entry.itemId)}
                  disabled={pending}
                  aria-label="Quitar ítem de la lista"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={materializeOpen} onOpenChange={setMaterializeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear evaluación desde la lista</DialogTitle>
            <DialogDescription>
              Se creará un instrumento (borrador) con {items.length} ítem
              {items.length === 1 ? '' : 's'} copiado{items.length === 1 ? '' : 's'} desde esta
              lista. Podrás editarlo después.
            </DialogDescription>
          </DialogHeader>
          <Field label="Nombre de la evaluación" htmlFor="instrument-name" required>
            <Input
              id="instrument-name"
              value={instrumentName}
              onChange={(event) => setInstrumentName(event.target.value)}
              maxLength={300}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMaterializeOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={handleMaterialize} disabled={pending}>
              {pending ? 'Creando...' : 'Crear evaluación'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
