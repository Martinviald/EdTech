'use client';

import { useState } from 'react';
import { ListPlus, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SaveToCollectionDialog } from './save-to-collection-dialog';

// Menú de acciones (kebab) para el panel de detalle de un ítem. Hoy expone
// "Agregar a una colección" (T2-22), reutilizando el mismo SaveToCollectionDialog
// del banco. Se muestra sólo a quien puede gestionar colecciones (gating en el
// caller); la API igualmente re-valida el rol.
export function AddToCollectionMenu({ itemId }: { itemId: string }) {
  const [saveOpen, setSaveOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label="Más acciones">
            <MoreVertical className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setSaveOpen(true);
            }}
          >
            <ListPlus className="mr-2 size-4" aria-hidden />
            Agregar a una colección
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SaveToCollectionDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        itemIds={[itemId]}
        onSaved={() => undefined}
      />
    </>
  );
}
