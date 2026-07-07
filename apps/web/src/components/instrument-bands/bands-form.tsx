'use client';

import { useState, useTransition } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { PerformanceBandResponseModel } from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { upsertInstrumentBandsAction } from './actions';

type Row = { key: string; label: string; min: string; max: string; color: string };

function toRow(b: PerformanceBandResponseModel): Row {
  return {
    key: b.key,
    label: b.label,
    min: Number(b.minThreshold).toString(),
    max: Number(b.maxThreshold).toString(),
    color: b.color ?? '#2c6b5b',
  };
}

function blankRow(): Row {
  return { key: '', label: '', min: '', max: '', color: '#2c6b5b' };
}

/**
 * Valida el set completo: ordenado por posición debe cubrir [0,1] sin huecos ni
 * solapes (min inclusivo, max exclusivo). Devuelve un mensaje de error o null.
 * El backend revalida con el mismo criterio (upsertInstrumentBandsSchema).
 */
function validate(rows: Row[]): string | null {
  if (rows.length === 0) return 'Agrega al menos una banda.';
  const EPS = 1e-6;
  for (const r of rows) {
    if (!r.key.trim() || !r.label.trim()) return 'Cada banda necesita clave y etiqueta.';
    const min = Number(r.min);
    const max = Number(r.max);
    if (Number.isNaN(min) || Number.isNaN(max)) return 'Los umbrales deben ser números (0 a 1).';
    if (min < 0 || max > 1) return 'Los umbrales van entre 0 y 1.';
    if (min >= max) return `La banda "${r.label || r.key}": el umbral mínimo debe ser menor al máximo.`;
  }
  if (Math.abs(Number(rows[0]!.min) - 0) > EPS) return 'La primera banda debe arrancar en 0.';
  if (Math.abs(Number(rows[rows.length - 1]!.max) - 1) > EPS) return 'La última banda debe terminar en 1.';
  for (let i = 1; i < rows.length; i++) {
    if (Math.abs(Number(rows[i]!.min) - Number(rows[i - 1]!.max)) > EPS) {
      return `Hueco o solape entre "${rows[i - 1]!.label}" y "${rows[i]!.label}": el mínimo de una debe igualar el máximo de la anterior.`;
    }
  }
  return null;
}

export function BandsForm({
  instrumentId,
  initial,
}: {
  instrumentId: string;
  initial: PerformanceBandResponseModel[];
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    initial.length > 0 ? initial.map(toRow) : [blankRow()],
  );
  const [saving, startTransition] = useTransition();

  function patch(i: number, p: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, blankRow()]);
  }
  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  }

  function save() {
    const error = validate(rows);
    if (error) {
      toast.error(error);
      return;
    }
    startTransition(async () => {
      try {
        await upsertInstrumentBandsAction(instrumentId, {
          // El orden se asigna por posición en la lista (menor a mayor logro).
          bands: rows.map((r, i) => ({
            key: r.key.trim(),
            label: r.label.trim(),
            order: i,
            minThreshold: Number(r.min),
            maxThreshold: Number(r.max),
            color: r.color || null,
          })),
        });
        toast.success('Niveles guardados. Recalcula la evaluación para ver los cambios.');
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'No se pudieron guardar los niveles.');
      }
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        Define los niveles de menor a mayor logro. Los umbrales son fracciones de 0 a 1
        (ej. 0.75 = 75%) y deben cubrir todo el rango sin huecos: el mínimo de cada banda es
        igual al máximo de la anterior. Al guardar, recalcula la evaluación para aplicar los
        nuevos cortes.
      </p>

      {rows.map((row, i) => (
        <Card key={i}>
          <CardContent className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-12 sm:items-end">
            <div className="space-y-1.5 sm:col-span-3">
              <Label htmlFor={`label-${i}`}>Etiqueta</Label>
              <Input
                id={`label-${i}`}
                value={row.label}
                placeholder="Nivel III"
                onChange={(e) => patch(i, { label: e.target.value })}
                disabled={saving}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-3">
              <Label htmlFor={`key-${i}`}>Clave</Label>
              <Input
                id={`key-${i}`}
                value={row.key}
                placeholder="dia_nivel_3"
                onChange={(e) => patch(i, { key: e.target.value })}
                disabled={saving}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={`min-${i}`}>Mín (0–1)</Label>
              <Input
                id={`min-${i}`}
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={row.min}
                onChange={(e) => patch(i, { min: e.target.value })}
                disabled={saving}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={`max-${i}`}>Máx (0–1)</Label>
              <Input
                id={`max-${i}`}
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={row.max}
                onChange={(e) => patch(i, { max: e.target.value })}
                disabled={saving}
              />
            </div>
            <div className="flex items-end gap-2 sm:col-span-2">
              <div className="space-y-1.5">
                <Label htmlFor={`color-${i}`}>Color</Label>
                <Input
                  id={`color-${i}`}
                  type="color"
                  value={row.color}
                  onChange={(e) => patch(i, { color: e.target.value })}
                  disabled={saving}
                  className="h-9 w-14 p-1"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeRow(i)}
                disabled={saving || rows.length <= 1}
                aria-label="Eliminar banda"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" onClick={addRow} disabled={saving}>
          <Plus className="mr-1.5 h-4 w-4" />
          Agregar nivel
        </Button>
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar niveles'}
        </Button>
      </div>
    </div>
  );
}
