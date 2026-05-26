'use client';

import { useState, useTransition } from 'react';
import { Calculator, X } from 'lucide-react';
import type { GradingScalePreviewItem } from '@soe/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { previewConversionAction } from '../actions';
import { formatGrade } from './scale-format';

const DEFAULT_PERCENTAGES = [0, 30, 50, 60, 70, 85, 100] as const;

export function ConversionPreview({ scaleId }: { scaleId: string }) {
  const [percentages, setPercentages] = useState<number[]>([...DEFAULT_PERCENTAGES]);
  const [draft, setDraft] = useState('');
  const [results, setResults] = useState<GradingScalePreviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function addPercentage() {
    const value = Number(draft);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      setError('Ingresa un porcentaje entre 0 y 100.');
      return;
    }
    setError(null);
    setPercentages((prev) =>
      [...new Set([...prev, value])].sort((a, b) => a - b),
    );
    setDraft('');
  }

  function removePercentage(value: number) {
    setPercentages((prev) => prev.filter((p) => p !== value));
  }

  function reset() {
    setPercentages([...DEFAULT_PERCENTAGES]);
    setResults(null);
    setError(null);
  }

  function handleCalculate() {
    setError(null);
    if (percentages.length === 0) {
      setError('Agrega al menos un porcentaje para previsualizar.');
      return;
    }
    startTransition(async () => {
      try {
        const response = await previewConversionAction(scaleId, percentages);
        setResults(response.results);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'No se pudo calcular la previsualización.';
        setError(message);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Previsualizar conversión</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Ingresa porcentajes de logro para ver qué nota produce esta escala. Útil para validar el
          umbral y los extremos.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[180px] space-y-2">
          <Label htmlFor="preview-percentage">Agregar porcentaje</Label>
          <Input
            id="preview-percentage"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step="1"
            placeholder="Ej: 75"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addPercentage();
              }
            }}
            disabled={pending}
          />
        </div>
        <Button type="button" variant="outline" onClick={addPercentage} disabled={pending}>
          Agregar
        </Button>
        <Button type="button" variant="ghost" onClick={reset} disabled={pending}>
          Restablecer
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {percentages.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No hay porcentajes seleccionados todavía.
          </p>
        ) : (
          percentages.map((p) => (
            <Badge key={p} variant="secondary" className="gap-1 pl-2.5 pr-1">
              {p}%
              <button
                type="button"
                onClick={() => removePercentage(p)}
                className="hover:bg-muted rounded-full p-0.5"
                aria-label={`Quitar ${p}%`}
                disabled={pending}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))
        )}
      </div>

      <div>
        <Button type="button" onClick={handleCalculate} disabled={pending}>
          <Calculator className="mr-2 size-4" />
          {pending ? 'Calculando…' : 'Calcular'}
        </Button>
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      {results ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Porcentaje de logro</TableHead>
                <TableHead>Nota</TableHead>
                <TableHead>Aprobación</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((row) => (
                <TableRow key={row.percentage}>
                  <TableCell className="font-medium">{row.percentage}%</TableCell>
                  <TableCell>{formatGrade(row.grade)}</TableCell>
                  <TableCell>
                    {row.passed ? (
                      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                        Aprobado
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-destructive">
                        Reprobado
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}
