'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import {
  createMeasurementProcessSchema,
  INSTRUMENT_APPLICATION_PERIODS,
  INSTRUMENT_APPLICATION_PERIOD_LABELS,
  PROCESS_KINDS,
  PROCESS_KIND_LABELS,
  PROCESS_STATUSES,
  PROCESS_STATUS_LABELS,
  type InstrumentApplicationPeriod,
  type MeasurementProcessModel,
  type PeriodFilterOption,
  type ProcessKind,
  type ProcessStatus,
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Field } from '@/components/shared';
import { createProcess, updateProcess } from '../actions';

const NO_PERIOD = 'none';

export function ProcessFormDialog({
  trigger,
  academicYears,
  process,
}: {
  trigger: ReactNode;
  academicYears: readonly PeriodFilterOption[];
  process?: MeasurementProcessModel;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(process?.name ?? '');
  const [academicYearId, setAcademicYearId] = useState(
    process?.academicYearId ??
      academicYears.find((y) => y.isCurrent)?.id ??
      academicYears[0]?.id ??
      '',
  );
  const [kind, setKind] = useState<ProcessKind>(process?.kind ?? 'dia');
  const [period, setPeriod] = useState<string>(process?.period ?? NO_PERIOD);
  const [status, setStatus] = useState<ProcessStatus>(process?.status ?? 'planned');
  const [startsOn, setStartsOn] = useState(process?.startsOn ?? '');
  const [endsOn, setEndsOn] = useState(process?.endsOn ?? '');
  const [notes, setNotes] = useState(process?.notes ?? '');

  const isEdit = process !== undefined;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const payload = {
      name: name.trim(),
      academicYearId,
      kind,
      period: period === NO_PERIOD ? null : (period as InstrumentApplicationPeriod),
      status,
      startsOn: startsOn || null,
      endsOn: endsOn || null,
      notes: notes.trim() || null,
    };

    const parsed = createMeasurementProcessSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Datos inválidos');
      return;
    }
    if (payload.startsOn && payload.endsOn && payload.endsOn < payload.startsOn) {
      toast.error('La fecha de término no puede ser anterior a la de inicio.');
      return;
    }

    startTransition(async () => {
      const result = isEdit
        ? await updateProcess(process.id, parsed.data)
        : await createProcess(parsed.data);

      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(isEdit ? 'Proceso actualizado.' : 'Proceso creado.');
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar proceso' : 'Nuevo proceso de medición'}</DialogTitle>
          <DialogDescription>
            Una ventana de aplicación que el colegio cierra como una unidad: un momento DIA, una
            toma de ensayo, una evaluación semestral.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Nombre">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Monitoreo Intermedio 2026"
              required
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Año académico">
              <Select value={academicYearId} onValueChange={setAcademicYearId} disabled={isEdit}>
                <SelectTrigger>
                  <SelectValue placeholder="Elige un año" />
                </SelectTrigger>
                <SelectContent>
                  {academicYears.map((year) => (
                    <SelectItem key={year.id} value={year.id}>
                      {year.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Tipo">
              <Select value={kind} onValueChange={(v) => setKind(v as ProcessKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROCESS_KINDS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {PROCESS_KIND_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Momento">
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_PERIOD}>Sin momento</SelectItem>
                  {INSTRUMENT_APPLICATION_PERIODS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {INSTRUMENT_APPLICATION_PERIOD_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Estado">
              <Select value={status} onValueChange={(v) => setStatus(v as ProcessStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROCESS_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {PROCESS_STATUS_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Inicio">
              <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </Field>

            <Field label="Término">
              <Input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
            </Field>
          </div>

          <Field label="Notas">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Contexto de la aplicación, acuerdos del equipo…"
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || !academicYearId}>
              {pending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
              {isEdit ? 'Guardar cambios' : 'Crear proceso'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
