'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, LayoutGrid } from 'lucide-react';
import {
  expandExpectedCells,
  type ClassGroupFilterOption,
  type FilterOption,
  type MeasurementProcessModel,
} from '@soe/types';
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
import { Field, MultiSelectFilter } from '@/components/shared';
import { updateProcess } from '../../actions';

export function ScopeDialog({
  process,
  classGroups,
  subjects,
}: {
  process: MeasurementProcessModel;
  classGroups: readonly ClassGroupFilterOption[];
  subjects: readonly FilterOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [classGroupIds, setClassGroupIds] = useState<string[]>(
    process.expectedScope.classGroupIds ?? [],
  );
  const [subjectIds, setSubjectIds] = useState<string[]>(process.expectedScope.subjectIds ?? []);

  const cellCount = expandExpectedCells({ classGroupIds, subjectIds }).length;

  function handleSave() {
    startTransition(async () => {
      const result = await updateProcess(process.id, {
        expectedScope: {
          classGroupIds,
          subjectIds,
          excludedCells: process.expectedScope.excludedCells,
        },
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success('Alcance actualizado.');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <LayoutGrid className="mr-2 size-4" aria-hidden />
          Declarar alcance
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Alcance esperado del proceso</DialogTitle>
          <DialogDescription>
            El denominador de la rendición: qué cursos y asignaturas debería cubrir este proceso.
            Sin esto la plataforma sólo puede mostrar lo que existe, no lo que falta.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Cursos">
            <MultiSelectFilter
              label="cursos"
              placeholder="Elige los cursos"
              options={classGroups.map((c) => ({ id: c.id, label: c.label }))}
              selected={classGroupIds}
              onChange={setClassGroupIds}
            />
          </Field>

          <Field label="Asignaturas">
            <MultiSelectFilter
              label="asignaturas"
              placeholder="Elige las asignaturas"
              options={subjects.map((s) => ({ id: s.id, label: s.label }))}
              selected={subjectIds}
              onChange={setSubjectIds}
            />
          </Field>

          <p className="text-muted-foreground text-sm">
            {cellCount > 0
              ? `${cellCount} celda(s) esperadas: ${classGroupIds.length} curso(s) × ${subjectIds.length} asignatura(s).`
              : 'Elige al menos un curso y una asignatura para que la cobertura mida algo.'}
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSave} disabled={pending}>
            {pending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
            Guardar alcance
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
