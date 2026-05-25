'use client';

import { useMemo, useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { TeacherAssignmentSummary } from '@soe/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/EmptyState';
import { deleteAssignmentAction } from './actions';

const ALL = '__all__';

type Filters = {
  classGroupId: string;
  subjectId: string;
  teacherQuery: string;
};

export function AssignmentsTable({
  orgId,
  rows,
}: {
  orgId: string;
  rows: TeacherAssignmentSummary[];
}) {
  const [filters, setFilters] = useState<Filters>({
    classGroupId: ALL,
    subjectId: ALL,
    teacherQuery: '',
  });

  const classGroupOptions = useMemo(() => {
    const seen = new Map<string, { id: string; label: string }>();
    rows.forEach((r) => {
      const cg = r.subjectClass.classGroup;
      seen.set(cg.id, { id: cg.id, label: `${cg.gradeShortName} · ${cg.name}` });
    });
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const subjectOptions = useMemo(() => {
    const seen = new Map<string, { id: string; label: string }>();
    rows.forEach((r) => {
      const s = r.subjectClass.subject;
      seen.set(s.id, { id: s.id, label: s.name });
    });
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = filters.teacherQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (filters.classGroupId !== ALL && r.subjectClass.classGroup.id !== filters.classGroupId)
        return false;
      if (filters.subjectId !== ALL && r.subjectClass.subject.id !== filters.subjectId)
        return false;
      if (
        q &&
        !r.teacher.name.toLowerCase().includes(q) &&
        !r.teacher.email.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [rows, filters]);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Sin asignaciones aún"
        description="Usa el botón 'Asignar profesor' para conectar a un profesor con un curso y asignatura."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          value={filters.classGroupId}
          onValueChange={(v) => setFilters((f) => ({ ...f, classGroupId: v }))}
        >
          <SelectTrigger>
            <SelectValue placeholder="Filtrar por curso" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los cursos</SelectItem>
            {classGroupOptions.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.subjectId}
          onValueChange={(v) => setFilters((f) => ({ ...f, subjectId: v }))}
        >
          <SelectTrigger>
            <SelectValue placeholder="Filtrar por asignatura" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas las asignaturas</SelectItem>
            {subjectOptions.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Buscar profesor…"
          value={filters.teacherQuery}
          onChange={(e) => setFilters((f) => ({ ...f, teacherQuery: e.target.value }))}
        />
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Curso</TableHead>
              <TableHead>Asignatura</TableHead>
              <TableHead>Profesor</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                  Sin resultados para los filtros aplicados.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => (
                <AssignmentRow key={row.id} orgId={orgId} row={row} />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AssignmentRow({
  orgId,
  row,
}: {
  orgId: string;
  row: TeacherAssignmentSummary;
}) {
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    if (!confirm(`¿Desasignar a ${row.teacher.name} de ${row.subjectClass.subject.shortName}?`))
      return;
    startTransition(async () => {
      const res = await deleteAssignmentAction(orgId, row.id);
      if (res.ok) toast.success('Asignación eliminada');
      else toast.error(res.error);
    });
  }

  return (
    <TableRow>
      <TableCell className="font-medium">
        {row.subjectClass.classGroup.gradeShortName} · {row.subjectClass.classGroup.name}
      </TableCell>
      <TableCell>{row.subjectClass.subject.name}</TableCell>
      <TableCell>
        <div className="font-medium">{row.teacher.name}</div>
        <div className="text-xs text-muted-foreground">{row.teacher.email}</div>
      </TableCell>
      <TableCell>
        <Badge variant={row.role === 'primary' ? 'default' : 'secondary'}>
          {row.role === 'primary' ? 'Titular' : 'Asistente'}
        </Badge>
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          disabled={pending}
          aria-label="Desasignar"
        >
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
