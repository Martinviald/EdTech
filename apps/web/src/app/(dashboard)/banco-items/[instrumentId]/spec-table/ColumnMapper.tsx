'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const TARGET_FIELDS = [
  { value: 'position', label: 'Posicion (numero de pregunta)' },
  { value: 'skill', label: 'Habilidad' },
  { value: 'oa', label: 'Objetivo de Aprendizaje (OA)' },
  { value: 'content', label: 'Contenido / Eje tematico' },
  { value: 'correct_key', label: 'Clave correcta' },
  { value: 'type', label: 'Tipo de item' },
  { value: 'points', label: 'Puntaje' },
] as const;

const IGNORE_VALUE = '__ignore__';

interface ColumnMapperProps {
  columns: string[];
  onLink: (mapping: Record<string, string>) => void;
  onCancel: () => void;
  isPending: boolean;
}

export function ColumnMapper({ columns, onLink, onCancel, isPending }: ColumnMapperProps) {
  const [mapping, setMapping] = useState<Record<string, string>>(() => {
    // Auto-detect common column names
    const initial: Record<string, string> = {};
    for (const col of columns) {
      const lower = col.toLowerCase().trim();
      if (lower.includes('posic') || lower.includes('pregunta') || lower === '#' || lower === 'n') {
        initial[col] = 'position';
      } else if (lower.includes('habilidad') || lower.includes('skill')) {
        initial[col] = 'skill';
      } else if (lower.includes('oa') || lower.includes('objetivo')) {
        initial[col] = 'oa';
      } else if (lower.includes('contenido') || lower.includes('eje') || lower.includes('content')) {
        initial[col] = 'content';
      } else if (lower.includes('clave') || lower.includes('correcta') || lower.includes('key')) {
        initial[col] = 'correct_key';
      } else if (lower.includes('tipo') || lower.includes('type')) {
        initial[col] = 'type';
      } else if (lower.includes('puntaje') || lower.includes('punto') || lower.includes('points')) {
        initial[col] = 'points';
      }
    }
    return initial;
  });

  const handleChange = (column: string, target: string) => {
    setMapping((prev) => {
      const next = { ...prev };
      if (target === IGNORE_VALUE) {
        delete next[column];
      } else {
        next[column] = target;
      }
      return next;
    });
  };

  const handleSubmit = () => {
    const mapped = Object.entries(mapping).filter(([, v]) => v !== IGNORE_VALUE);
    if (mapped.length === 0) {
      toast.error('Debes mapear al menos una columna');
      return;
    }
    // Build the final mapping: target_field -> source_column
    const finalMapping: Record<string, string> = {};
    for (const [sourceCol, targetField] of mapped) {
      finalMapping[targetField] = sourceCol;
    }
    onLink(finalMapping);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mapeo de columnas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Indica a que campo corresponde cada columna del archivo. Las columnas no
          asignadas seran ignoradas.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {columns.map((col) => (
            <div key={col} className="space-y-1">
              <Label className="text-xs font-medium">{col}</Label>
              <Select
                value={mapping[col] ?? IGNORE_VALUE}
                onValueChange={(v) => handleChange(col, v)}
                disabled={isPending}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Ignorar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={IGNORE_VALUE}>
                    <span className="text-muted-foreground">Ignorar</span>
                  </SelectItem>
                  {TARGET_FIELDS.map((field) => (
                    <SelectItem key={field.value} value={field.value}>
                      {field.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isPending ? 'Vinculando...' : 'Vincular items'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
