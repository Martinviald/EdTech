'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AdminGrade, SubjectMatrix } from '@/lib/adminApi';
import { createClassGroupAction, deleteClassGroupAction } from './actions';

export function CoursesManager({
  orgId,
  matrix,
  grades,
}: {
  orgId: string;
  matrix: SubjectMatrix;
  grades: AdminGrade[];
}) {
  if (!matrix.academicYear) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sin año académico configurado</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Configurá el año académico inicial desde el botón &ldquo;Configurar año académico&rdquo;
          en la pestaña Perfil.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Año académico {matrix.academicYear.year} · {matrix.classGroups.length} curso(s)
        </p>
        <AddClassGroupDialog orgId={orgId} grades={grades} />
      </div>

      {matrix.classGroups.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No hay cursos cargados. Agregá el primero con el botón de arriba.
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">Nivel</th>
                <th className="px-3 py-2 font-medium">Sección</th>
                <th className="w-24 px-3 py-2 text-right font-medium">Acción</th>
              </tr>
            </thead>
            <tbody>
              {matrix.classGroups.map((cg) => (
                <tr key={cg.id} className="border-t">
                  <td className="px-3 py-2">{cg.gradeName}</td>
                  <td className="px-3 py-2 font-medium">{cg.name}</td>
                  <td className="px-3 py-2 text-right">
                    <DeleteClassGroupButton
                      orgId={orgId}
                      classGroupId={cg.id}
                      label={`${cg.gradeShortName} · ${cg.name}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AddClassGroupDialog({ orgId, grades }: { orgId: string; grades: AdminGrade[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [gradeId, setGradeId] = useState('');
  const [name, setName] = useState('');
  const [isPending, startTransition] = useTransition();

  const reset = () => {
    setGradeId('');
    setName('');
  };

  const onSubmit = () => {
    if (!gradeId || !name.trim()) {
      toast.error('Completá nivel y sección');
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set('gradeId', gradeId);
      fd.set('name', name.trim());
      const result = await createClassGroupAction(orgId, fd);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Curso creado');
      reset();
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 size-4" /> Agregar curso
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar curso al año vigente</DialogTitle>
          <DialogDescription>
            El curso heredará las asignaturas ya configuradas en el año.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nivel</Label>
            <Select value={gradeId} onValueChange={setGradeId} disabled={isPending}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccioná un nivel" />
              </SelectTrigger>
              <SelectContent>
                {grades.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Sección</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="A, B, C..."
              maxLength={20}
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              Convención del sistema: la sección es solo la letra (ej. &ldquo;A&rdquo;), no el
              nombre completo del curso.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} disabled={isPending}>
            {isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Crear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteClassGroupButton({
  orgId,
  classGroupId,
  label,
}: {
  orgId: string;
  classGroupId: string;
  label: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const onDelete = () => {
    startTransition(async () => {
      const result = await deleteClassGroupAction(orgId, classGroupId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Curso ${label} eliminado`);
      router.refresh();
    });
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={isPending}>
          <Trash2 className="size-4 text-destructive" />
          <span className="sr-only">Eliminar curso {label}</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Eliminar curso {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            Si el curso tiene alumnos, asignaciones o evaluaciones, el servidor lo rechazará y
            te indicará qué falta limpiar.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onDelete}>Sí, eliminar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
