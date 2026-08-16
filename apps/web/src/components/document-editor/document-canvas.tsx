'use client';

import { ArrowDown, ArrowUp, Copy, LayoutList, Plus, Trash2 } from 'lucide-react';
import type { Block, BlockType } from '@soe/types';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared';
import { BLOCK_TYPE_ORDER, getBlockDefinition } from './block-registry';

interface DocumentCanvasProps {
  value: Block[];
  onChange: (blocks: Block[]) => void;
  assets?: Record<string, string>;
  /** Tipos ofrecidos por el insertador; por defecto todos los del registro. */
  insertableTypes?: readonly BlockType[];
  /** Ver BlockEditProps.onEditItem. */
  onEditItem?: (block: Extract<Block, { type: 'item' }>) => void;
  /** Acciones extra del host junto al insertador (p. ej. "Agregar preguntas"). */
  insertActions?: React.ReactNode;
}

export function DocumentCanvas({
  value,
  onChange,
  assets,
  insertableTypes = BLOCK_TYPE_ORDER,
  onEditItem,
  insertActions,
}: DocumentCanvasProps) {
  function replaceAt(index: number, block: Block) {
    onChange(value.map((current, i) => (i === index ? block : current)));
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    const source = value[index];
    const displaced = value[target];
    if (!source || !displaced) return;
    const next = [...value];
    next[index] = displaced;
    next[target] = source;
    onChange(next);
  }

  function duplicate(index: number) {
    const source = value[index];
    if (!source) return;
    const clone = structuredClone(source);
    clone.id = crypto.randomUUID();
    onChange([...value.slice(0, index + 1), clone, ...value.slice(index + 1)]);
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function append(type: BlockType) {
    onChange([...value, getBlockDefinition(type).makeDefault()]);
  }

  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <EmptyState
          icon={LayoutList}
          title="Documento vacío"
          description="Agrega tu primer bloque con los botones de abajo."
        />
      ) : null}

      {value.map((block, index) => {
        const definition = getBlockDefinition(block.type);
        const Icon = definition.icon;
        return (
          <div
            key={block.id}
            className="group relative rounded-lg border border-transparent p-3 pt-4 transition-colors focus-within:border-border hover:border-border hover:bg-muted/10"
          >
            <div className="absolute -top-3 right-3 z-10 flex items-center gap-0.5 rounded-md border border-border bg-background px-1 py-0.5 opacity-0 shadow-sm transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <span className="mr-1 hidden items-center gap-1 px-1 text-xs text-muted-foreground sm:flex">
                <Icon className="size-3.5" aria-hidden />
                {definition.label}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                aria-label="Subir bloque"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                aria-label="Bajar bloque"
                disabled={index === value.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                aria-label="Duplicar bloque"
                onClick={() => duplicate(index)}
              >
                <Copy />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                aria-label="Eliminar bloque"
                onClick={() => remove(index)}
              >
                <Trash2 />
              </Button>
            </div>
            <definition.EditView
              block={block}
              onChange={(next) => replaceAt(index, next)}
              assets={assets}
              onEditItem={onEditItem}
            />
          </div>
        );
      })}

      <div className="rounded-lg border border-dashed border-border p-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Plus className="size-3.5" aria-hidden />
          Agregar bloque
        </p>
        <div className="flex flex-wrap gap-2">
          {insertableTypes.map((type) => {
            const definition = getBlockDefinition(type);
            return (
              <Button
                key={type}
                type="button"
                variant="outline"
                size="sm"
                icon={definition.icon}
                onClick={() => append(type)}
              >
                {definition.label}
              </Button>
            );
          })}
          {insertActions}
        </div>
      </div>
    </div>
  );
}
