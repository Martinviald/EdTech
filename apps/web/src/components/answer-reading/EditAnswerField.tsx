'use client';

import { useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { EditShape } from './edit-answer';

interface EditAnswerFieldProps {
  shape: EditShape;
  parts: string[];
  pending: boolean;
  onChange: (parts: string[]) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

const NUMERIC_INPUT_CLASS = 'h-11 w-24 text-center font-mono text-lg';

export function EditAnswerField({
  shape,
  parts,
  pending,
  onChange,
  onSubmit,
  onCancel,
}: EditAnswerFieldProps) {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>('input, textarea')?.focus();
  }, []);

  const setPart = (index: number, value: string) => {
    const next = [...parts];
    next[index] = value;
    onChange(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSubmit();
  };

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      onKeyDown={handleKeyDown}
      className="space-y-3 rounded-md border bg-muted/30 p-3"
      aria-label="Editar la respuesta"
    >
      <p className="text-sm font-medium text-foreground">Escribe lo que respondió el alumno</p>
      <EditInputs shape={shape} parts={parts} setPart={setPart} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          <Check className="mr-2 size-4" aria-hidden />
          Guardar edición
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          <X className="mr-2 size-4" aria-hidden />
          Cancelar
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Enter guarda · Esc cancela</p>
    </form>
  );
}

function EditInputs({
  shape,
  parts,
  setPart,
}: {
  shape: EditShape;
  parts: string[];
  setPart: (index: number, value: string) => void;
}) {
  if (shape.kind === 'fraction') {
    const offset = shape.mixed ? 1 : 0;
    return (
      <div className="flex items-center gap-2">
        {shape.mixed && (
          <Input
            inputMode="numeric"
            aria-label="Parte entera (opcional)"
            placeholder="Entero"
            className={NUMERIC_INPUT_CLASS}
            value={parts[0] ?? ''}
            onChange={(e) => setPart(0, e.target.value)}
          />
        )}
        <div className="inline-flex flex-col items-center gap-1">
          <Input
            inputMode="numeric"
            aria-label="Numerador"
            className={NUMERIC_INPUT_CLASS}
            value={parts[offset] ?? ''}
            onChange={(e) => setPart(offset, e.target.value)}
          />
          <span aria-hidden className="h-0.5 w-24 rounded bg-foreground" />
          <Input
            inputMode="numeric"
            aria-label="Denominador"
            className={NUMERIC_INPUT_CLASS}
            value={parts[offset + 1] ?? ''}
            onChange={(e) => setPart(offset + 1, e.target.value)}
          />
        </div>
      </div>
    );
  }

  if (shape.kind === 'tuple') {
    return (
      <div className="flex flex-wrap items-center gap-1 font-mono text-lg">
        <span aria-hidden>(</span>
        {Array.from({ length: shape.arity }, (_, index) => (
          <span key={index} className="flex items-center gap-1">
            {index > 0 && <span aria-hidden>;</span>}
            <Input
              aria-label={`Componente ${index + 1} del par`}
              className={NUMERIC_INPUT_CLASS}
              value={parts[index] ?? ''}
              onChange={(e) => setPart(index, e.target.value)}
            />
          </span>
        ))}
        <span aria-hidden>)</span>
      </div>
    );
  }

  if (shape.kind === 'multi_box') {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {shape.boxes.map((box, index) => (
          <label key={index} className="flex flex-col gap-1 text-xs text-muted-foreground">
            <span>{box.label}</span>
            <Input
              aria-label={`Casilla ${box.label}`}
              inputMode={box.kind === 'short_text' ? 'text' : 'decimal'}
              className="h-11 font-mono"
              value={parts[index] ?? ''}
              onChange={(e) => setPart(index, e.target.value)}
            />
          </label>
        ))}
      </div>
    );
  }

  if (shape.kind === 'text' && shape.multiline) {
    return (
      <Textarea
        aria-label="Respuesta del alumno"
        rows={4}
        value={parts[0] ?? ''}
        onChange={(e) => setPart(0, e.target.value)}
      />
    );
  }

  return (
    <Input
      aria-label="Respuesta del alumno"
      inputMode={shape.kind === 'text' ? 'text' : 'decimal'}
      className="h-11 max-w-xs font-mono text-lg"
      value={parts[0] ?? ''}
      onChange={(e) => setPart(0, e.target.value)}
    />
  );
}
