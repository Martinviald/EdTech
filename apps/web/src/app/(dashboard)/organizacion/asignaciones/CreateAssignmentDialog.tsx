'use client';

import { useMemo, useState, useTransition } from 'react';
import { UserPlus } from 'lucide-react';
import { toast } from 'sonner';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { OrgSubjectClass, OrgTeacher } from '@/lib/teacherAssignmentsApi';
import { createAssignmentAction } from './actions';

type Role = 'primary' | 'assistant';

export function CreateAssignmentDialog({
  orgId,
  teachers,
  subjectClasses,
}: {
  orgId: string;
  teachers: OrgTeacher[];
  subjectClasses: OrgSubjectClass[];
}) {
  const [open, setOpen] = useState(false);
  const [teacherId, setTeacherId] = useState('');
  const [classGroupId, setClassGroupId] = useState('');
  const [subjectClassId, setSubjectClassId] = useState('');
  const [role, setRole] = useState<Role>('primary');
  const [primaryConflictMsg, setPrimaryConflictMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setTeacherId('');
    setClassGroupId('');
    setSubjectClassId('');
    setRole('primary');
    setPrimaryConflictMsg(null);
  }

  const classGroups = useMemo(() => {
    const seen = new Map<
      string,
      { id: string; label: string; gradeOrder: number }
    >();
    subjectClasses.forEach((sc) => {
      seen.set(sc.classGroup.id, {
        id: sc.classGroup.id,
        label: `${sc.classGroup.gradeShortName} · ${sc.classGroup.name}`,
        gradeOrder: sc.classGroup.gradeOrder,
      });
    });
    return [...seen.values()].sort(
      (a, b) => a.gradeOrder - b.gradeOrder || a.label.localeCompare(b.label),
    );
  }, [subjectClasses]);

  const subjectsForClassGroup = useMemo(() => {
    if (!classGroupId) return [];
    return subjectClasses
      .filter((sc) => sc.classGroup.id === classGroupId)
      .sort((a, b) => a.subject.name.localeCompare(b.subject.name));
  }, [subjectClasses, classGroupId]);

  function handleSubmit(forcedRole?: Role) {
    if (!teacherId || !subjectClassId) {
      toast.error('Selecciona profesor, curso y asignatura');
      return;
    }
    const fd = new FormData();
    fd.set('userId', teacherId);
    fd.set('subjectClassId', subjectClassId);
    fd.set('role', forcedRole ?? role);
    startTransition(async () => {
      const res = await createAssignmentAction(orgId, fd);
      if (res.ok) {
        toast.success('Asignación creada');
        setOpen(false);
        reset();
        return;
      }
      if ('code' in res && res.code === 'PRIMARY_EXISTS') {
        setPrimaryConflictMsg(res.error);
        return;
      }
      toast.error(res.error);
    });
  }

  function handleConfirmAsAssistant() {
    setRole('assistant');
    setPrimaryConflictMsg(null);
    handleSubmit('assistant');
  }

  if (teachers.length === 0) {
    return (
      <Button disabled variant="outline">
        No hay profesores con membership activa
      </Button>
    );
  }

  if (subjectClasses.length === 0) {
    return (
      <Button disabled variant="outline">
        Configura el año académico primero
      </Button>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="mr-2 size-4" />
          Asignar profesor
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva asignación académica</DialogTitle>
          <DialogDescription>
            Conecta un profesor con una asignatura en un curso específico del año vigente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="teacher">Profesor</Label>
            <Select value={teacherId} onValueChange={setTeacherId}>
              <SelectTrigger id="teacher">
                <SelectValue placeholder="Selecciona un profesor" />
              </SelectTrigger>
              <SelectContent>
                {teachers.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} ({t.email})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="class-group">Curso</Label>
            <Select
              value={classGroupId}
              onValueChange={(v) => {
                setClassGroupId(v);
                setSubjectClassId('');
                setPrimaryConflictMsg(null);
              }}
            >
              <SelectTrigger id="class-group">
                <SelectValue placeholder="Selecciona un curso" />
              </SelectTrigger>
              <SelectContent>
                {classGroups.map((cg) => (
                  <SelectItem key={cg.id} value={cg.id}>
                    {cg.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="subject-class">Asignatura</Label>
            <Select
              value={subjectClassId}
              onValueChange={(v) => {
                setSubjectClassId(v);
                setPrimaryConflictMsg(null);
              }}
              disabled={!classGroupId}
            >
              <SelectTrigger id="subject-class">
                <SelectValue placeholder={classGroupId ? 'Selecciona' : 'Elige un curso primero'} />
              </SelectTrigger>
              <SelectContent>
                {subjectsForClassGroup.map((sc) => (
                  <SelectItem key={sc.id} value={sc.id}>
                    {sc.subject.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">Rol</Label>
            <Select
              value={role}
              onValueChange={(v) => {
                setRole(v as Role);
                setPrimaryConflictMsg(null);
              }}
            >
              <SelectTrigger id="role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="primary">Titular</SelectItem>
                <SelectItem value="assistant">Asistente / co-docente</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {primaryConflictMsg ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/30">
              <p className="font-medium text-amber-900 dark:text-amber-100">
                Conflicto de profesor titular
              </p>
              <p className="mt-1 text-amber-800 dark:text-amber-200">{primaryConflictMsg}</p>
              <p className="mt-2 text-amber-800 dark:text-amber-200">
                Puedes asignar a este profesor como <strong>asistente / co-docente</strong> en su
                lugar.
              </p>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          {primaryConflictMsg ? (
            <Button onClick={handleConfirmAsAssistant} disabled={pending}>
              {pending ? 'Guardando…' : 'Asignar como asistente'}
            </Button>
          ) : (
            <Button onClick={() => handleSubmit()} disabled={pending}>
              {pending ? 'Guardando…' : 'Asignar'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
