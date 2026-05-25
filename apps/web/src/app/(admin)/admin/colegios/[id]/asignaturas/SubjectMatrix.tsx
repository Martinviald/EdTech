'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { SubjectMatrix as MatrixData } from '@/lib/adminApi';
import { bulkAddSubjectsAction, toggleSubjectAction } from './actions';

export function SubjectMatrix({ orgId, matrix }: { orgId: string; matrix: MatrixData }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Cell key = `${classGroupId}|${subjectId}`
  const cellByKey = useMemo(() => {
    const m = new Map<string, { subjectClassId: string }>();
    for (const c of matrix.cells) {
      m.set(`${c.classGroupId}|${c.subjectId}`, { subjectClassId: c.subjectClassId });
    }
    return m;
  }, [matrix.cells]);

  const handleToggle = (
    classGroupId: string,
    subjectId: string,
    current: 'present' | 'absent',
    subjectClassId: string | null,
  ) => {
    startTransition(async () => {
      const result = await toggleSubjectAction(
        orgId,
        classGroupId,
        subjectId,
        current,
        subjectClassId,
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  };

  if (!matrix.academicYear) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sin año académico configurado</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Configurá el año académico desde la pestaña <strong>Cursos</strong> antes de gestionar
          las asignaturas.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Año académico {matrix.academicYear.year} · {matrix.classGroups.length} curso(s) ·{' '}
          {matrix.allSubjects.length} asignatura(s) globales
        </p>
        <BulkAddDialog
          orgId={orgId}
          matrix={matrix}
          disabled={isPending || matrix.classGroups.length === 0}
        />
      </div>

      {matrix.classGroups.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            El año vigente no tiene cursos. Creá cursos desde la pestaña{' '}
            <strong>Cursos</strong> primero.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Curso</th>
                {matrix.allSubjects.map((s) => (
                  <th
                    key={s.id}
                    className="px-3 py-2 text-center font-medium whitespace-nowrap"
                    title={s.name}
                  >
                    {s.shortName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.classGroups.map((cg) => (
                <tr key={cg.id} className="border-t">
                  <td className="px-3 py-2 font-medium whitespace-nowrap">
                    {cg.gradeShortName} · {cg.name}
                  </td>
                  {matrix.allSubjects.map((s) => {
                    const key = `${cg.id}|${s.id}`;
                    const cell = cellByKey.get(key);
                    const checked = !!cell;
                    return (
                      <td key={key} className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer"
                          checked={checked}
                          disabled={isPending}
                          onChange={() =>
                            handleToggle(
                              cg.id,
                              s.id,
                              checked ? 'present' : 'absent',
                              cell?.subjectClassId ?? null,
                            )
                          }
                          aria-label={`${s.name} en ${cg.gradeShortName} ${cg.name}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isPending ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Aplicando cambios...
        </div>
      ) : null}
    </div>
  );
}

function BulkAddDialog({
  orgId,
  matrix,
  disabled,
}: {
  orgId: string;
  matrix: MatrixData;
  disabled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  // Asignaturas que ya están en TODOS los cursos no se proponen para bulk.
  const presentEverywhere = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of matrix.cells) {
      counts.set(c.subjectId, (counts.get(c.subjectId) ?? 0) + 1);
    }
    const result = new Set<string>();
    for (const [id, count] of counts) {
      if (count === matrix.classGroups.length) result.add(id);
    }
    return result;
  }, [matrix.cells, matrix.classGroups.length]);

  const candidates = matrix.allSubjects.filter((s) => !presentEverywhere.has(s.id));

  const onSubmit = () => {
    startTransition(async () => {
      const result = await bulkAddSubjectsAction(orgId, Array.from(selected));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { created, alreadyExisting } = result.data!;
      toast.success(
        `Listo: ${created} asignación(es) nueva(s), ${alreadyExisting} ya existían.`,
      );
      setSelected(new Set());
      setOpen(false);
      router.refresh();
    });
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={disabled}>
          <Plus className="mr-2 size-4" />
          Agregar a todos los cursos
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar asignaturas al año vigente</DialogTitle>
          <DialogDescription>
            Cada asignatura seleccionada se vincula a TODOS los cursos del año. Las que ya
            existen no se duplican.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-64 space-y-1 overflow-y-auto rounded border p-2">
          {candidates.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">
              Todas las asignaturas globales ya están presentes en todos los cursos.
            </p>
          ) : (
            candidates.map((s) => (
              <label
                key={s.id}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={selected.has(s.id)}
                  onChange={() => toggle(s.id)}
                />
                <span>{s.name}</span>
                <span className="text-muted-foreground">({s.shortName})</span>
              </label>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} disabled={isPending || selected.size === 0}>
            {isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
