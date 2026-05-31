'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { toast } from 'sonner';
import {
  GRADING_SCALE_TYPE_VALUES,
  type GradingScaleCreateDto,
  type GradingScaleResponseModel,
  type GradingScaleTypeValue,
  type GradingScaleUpdateDto,
} from '@soe/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  createGradingScaleAction,
  updateGradingScaleAction,
} from '../actions';
import { SCALE_TYPE_LABELS } from './scale-format';

type Mode = 'create' | 'edit';

interface EscalaFormProps {
  mode: Mode;
  initial?: GradingScaleResponseModel;
  /** Si true, el caller es platform_admin y puede marcar la escala como global. */
  canManageGlobal?: boolean;
}

interface FormState {
  name: string;
  type: GradingScaleTypeValue;
  minGrade: string;
  maxGrade: string;
  passingGrade: string;
  passingThresholdPercent: string;
  isGlobal: boolean;
}

function initialState(initial: GradingScaleResponseModel | undefined): FormState {
  if (initial) {
    return {
      name: initial.name,
      type: initial.type,
      minGrade: Number(initial.minGrade).toFixed(1),
      maxGrade: Number(initial.maxGrade).toFixed(1),
      passingGrade: Number(initial.passingGrade).toFixed(1),
      passingThresholdPercent: String(Math.round(Number(initial.passingThreshold) * 100)),
      isGlobal: initial.isGlobal,
    };
  }
  return {
    name: '',
    type: 'linear_chilean',
    minGrade: '1.0',
    maxGrade: '7.0',
    passingGrade: '4.0',
    passingThresholdPercent: '60',
    isGlobal: false,
  };
}

function validateClient(form: FormState): string | null {
  if (!form.name.trim()) return 'El nombre es obligatorio.';
  const min = Number(form.minGrade);
  const max = Number(form.maxGrade);
  const passing = Number(form.passingGrade);
  const thresholdPercent = Number(form.passingThresholdPercent);
  if (![min, max, passing, thresholdPercent].every(Number.isFinite)) {
    return 'Todos los valores numéricos son obligatorios.';
  }
  if (!(min < passing)) return 'La nota mínima debe ser menor que la nota de aprobación.';
  if (!(passing < max)) return 'La nota de aprobación debe ser menor que la nota máxima.';
  if (!(thresholdPercent > 0 && thresholdPercent < 100)) {
    return 'El umbral de aprobación debe estar entre 1% y 99%.';
  }
  return null;
}

export function EscalaForm({ mode, initial, canManageGlobal = false }: EscalaFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => initialState(initial));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const validationError = validateClient(form);
    if (validationError) {
      setError(validationError);
      return;
    }

    const payload: GradingScaleCreateDto | GradingScaleUpdateDto = {
      name: form.name.trim(),
      type: form.type,
      minGrade: Number(form.minGrade),
      maxGrade: Number(form.maxGrade),
      passingGrade: Number(form.passingGrade),
      passingThreshold: Number(form.passingThresholdPercent) / 100,
      ...(mode === 'create' && canManageGlobal ? { isGlobal: form.isGlobal } : {}),
    };

    startTransition(async () => {
      try {
        if (mode === 'create') {
          const created = await createGradingScaleAction(payload as GradingScaleCreateDto);
          toast.success('Escala creada');
          router.push(`/configuracion/escalas/${created.id}` as Route);
          router.refresh();
        } else if (initial) {
          await updateGradingScaleAction(initial.id, payload as GradingScaleUpdateDto);
          toast.success('Escala actualizada');
          router.refresh();
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error al guardar la escala';
        setError(message);
        toast.error(message);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="scale-name">Nombre</Label>
        <Input
          id="scale-name"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Ej: Escala chilena 60%"
          disabled={pending}
          required
          minLength={1}
          maxLength={200}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="scale-type">Tipo</Label>
        <Select
          value={form.type}
          onValueChange={(v) => set('type', v as GradingScaleTypeValue)}
          disabled={pending}
        >
          <SelectTrigger id="scale-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GRADING_SCALE_TYPE_VALUES.map((value) => (
              <SelectItem key={value} value={value}>
                {SCALE_TYPE_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="scale-min">Nota mínima</Label>
          <Input
            id="scale-min"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={form.minGrade}
            onChange={(e) => set('minGrade', e.target.value)}
            disabled={pending}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="scale-passing">Nota de aprobación</Label>
          <Input
            id="scale-passing"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={form.passingGrade}
            onChange={(e) => set('passingGrade', e.target.value)}
            disabled={pending}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="scale-max">Nota máxima</Label>
          <Input
            id="scale-max"
            type="number"
            inputMode="decimal"
            step="0.1"
            value={form.maxGrade}
            onChange={(e) => set('maxGrade', e.target.value)}
            disabled={pending}
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="scale-threshold">Umbral de aprobación (%)</Label>
        <Input
          id="scale-threshold"
          type="number"
          inputMode="numeric"
          min={1}
          max={99}
          step="1"
          value={form.passingThresholdPercent}
          onChange={(e) => set('passingThresholdPercent', e.target.value)}
          disabled={pending}
          required
        />
        <p className="text-muted-foreground text-xs">
          Porcentaje de logro mínimo para aprobar (ej: 60% es el estándar chileno).
        </p>
      </div>

      {mode === 'create' && canManageGlobal ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.isGlobal}
            onChange={(e) => set('isGlobal', e.target.checked)}
            disabled={pending}
          />
          Marcar como escala global (disponible para todas las organizaciones)
        </label>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={pending}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending
            ? mode === 'create'
              ? 'Creando…'
              : 'Guardando…'
            : mode === 'create'
              ? 'Crear escala'
              : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  );
}
