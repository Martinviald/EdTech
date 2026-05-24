'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ShieldPlus } from 'lucide-react';
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
import { grantPlatformAdminAction, searchUsersAction } from './actions';

type UserHit = { id: string; email: string; name: string };

export function AddAdminDialog() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<UserHit[]>([]);
  const [selected, setSelected] = useState<UserHit | null>(null);
  const [notes, setNotes] = useState('');
  const [pending, startTransition] = useTransition();

  function handleSearch(q: string) {
    setQuery(q);
    setSelected(null);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    startTransition(async () => {
      const results = await searchUsersAction(q);
      setHits(results);
    });
  }

  function handleSubmit() {
    if (!selected) {
      toast.error('Selecciona un usuario');
      return;
    }
    const fd = new FormData();
    fd.set('userId', selected.id);
    if (notes.trim()) fd.set('notes', notes.trim());
    startTransition(async () => {
      const result = await grantPlatformAdminAction(fd);
      if (result.ok) {
        toast.success('Platform admin agregado');
        setOpen(false);
        setQuery('');
        setSelected(null);
        setHits([]);
        setNotes('');
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <ShieldPlus className="mr-2 size-4" />
          Agregar admin
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Promover a platform admin</DialogTitle>
          <DialogDescription>
            Concede permisos globales. El usuario podrá crear colegios, gestionar miembros y otros admins.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="search">Usuario</Label>
            <Input
              id="search"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="email o nombre…"
            />
            {hits.length > 0 ? (
              <div className="max-h-48 overflow-y-auto rounded-md border">
                {hits.map((hit) => (
                  <button
                    type="button"
                    key={hit.id}
                    onClick={() => {
                      setSelected(hit);
                      setQuery(hit.email);
                      setHits([]);
                    }}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <div className="font-medium">{hit.name}</div>
                    <div className="text-xs text-muted-foreground">{hit.email}</div>
                  </button>
                ))}
              </div>
            ) : null}
            {selected ? (
              <p className="text-xs text-muted-foreground">
                Seleccionado: <span className="font-medium">{selected.email}</span>
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notas (opcional)</Label>
            <Input
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Motivo del acceso, contacto, etc."
              maxLength={500}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={pending || !selected}>
            {pending ? 'Guardando…' : 'Promover'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
