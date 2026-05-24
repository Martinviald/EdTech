'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
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
import { createCurriculum } from './actions';
import type { CreateCurriculumDto } from '@soe/types';

const TYPE_OPTIONS: Array<{ value: CreateCurriculumDto['type']; label: string }> = [
  { value: 'custom', label: 'Personalizado' },
  { value: 'mineduc', label: 'MINEDUC' },
  { value: 'simce', label: 'SIMCE' },
  { value: 'paes', label: 'PAES' },
  { value: 'dia', label: 'DIA' },
  { value: 'cambridge', label: 'Cambridge' },
  { value: 'aptus', label: 'Aptus' },
  { value: 'desafio', label: 'Desafío' },
];

export function NewCurriculumButton({ isPlatformAdmin }: { isPlatformAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<CreateCurriculumDto['type']>('custom');
  const [version, setVersion] = useState('');
  const [isOfficial, setIsOfficial] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function reset() {
    setName('');
    setType('custom');
    setVersion('');
    setIsOfficial(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('El nombre es obligatorio');
      return;
    }
    startTransition(async () => {
      try {
        const created = await createCurriculum({
          name: name.trim(),
          type,
          language: 'es',
          version: version.trim() || undefined,
          isOfficial: isPlatformAdmin && isOfficial,
        });
        toast.success('Currículum creado');
        setOpen(false);
        reset();
        router.refresh();
        router.push(`/curriculum/${created.id}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al crear');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Nuevo currículum</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nuevo currículum</DialogTitle>
            <DialogDescription>
              Crea un currículum personalizado para tu colegio (ej: plan lector, escalas internas).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="curriculum-name">
                Nombre
              </label>
              <Input
                id="curriculum-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Plan lector 2026"
                disabled={pending}
                required
                minLength={2}
                maxLength={200}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="curriculum-type">
                Tipo
              </label>
              <select
                id="curriculum-type"
                value={type}
                onChange={(e) => setType(e.target.value as CreateCurriculumDto['type'])}
                disabled={pending}
                className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1"
              >
                {TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="curriculum-version">
                Versión (opcional)
              </label>
              <Input
                id="curriculum-version"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="Ej: 2026"
                disabled={pending}
                maxLength={50}
              />
            </div>

            {isPlatformAdmin && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isOfficial}
                  onChange={(e) => setIsOfficial(e.target.checked)}
                  disabled={pending}
                />
                Marcar como oficial (compartido entre todas las organizaciones)
              </label>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
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
