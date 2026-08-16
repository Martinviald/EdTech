'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Circle, FileQuestion, Plus } from 'lucide-react';
import {
  ITEM_TYPES,
  ITEM_TYPE_LABELS,
  type Block,
  type CatalogEntryModel,
  type ItemModel,
  type ItemType,
  type PaginatedResponse,
} from '@soe/types';
import { apiClientGet } from '@/lib/api-client';
import { getDisplayMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared';

const PAGE_SIZE = 30;
const ALL = 'all';

function itemStem(content: Record<string, unknown>): string {
  for (const key of ['stem', 'prompt', 'passage', 'textWithGaps']) {
    const value = content[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return 'Ítem sin enunciado';
}

function toItemBlock(item: ItemModel): Block {
  return {
    id: crypto.randomUUID(),
    type: 'item',
    itemId: item.id,
    snapshot: { type: item.type, version: item.version, content: item.content },
  };
}

type ItemPickerDialogProps = {
  subjects: CatalogEntryModel[];
  grades: CatalogEntryModel[];
  onInsert: (blocks: Block[]) => void;
};

export function ItemPickerDialog({ subjects, grades, onInsert }: ItemPickerDialogProps) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>(ALL);
  const [subjectId, setSubjectId] = useState<string>(ALL);
  const [gradeId, setGradeId] = useState<string>(ALL);
  const [items, setItems] = useState<ItemModel[] | null>(null);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Map<string, ItemModel>>(new Map());

  const fetchItems = useCallback(async () => {
    setItems(null);
    const query = new URLSearchParams({ page: '1', pageSize: String(PAGE_SIZE), scope: 'all' });
    if (type !== ALL) query.set('type', type);
    if (subjectId !== ALL) query.set('subjectId', subjectId);
    if (gradeId !== ALL) query.set('gradeId', gradeId);
    try {
      const response = await apiClientGet<PaginatedResponse<ItemModel>>(
        `/items?${query.toString()}`,
      );
      setItems(response.data);
      setTotal(response.total);
    } catch (error) {
      setItems([]);
      setTotal(0);
      toast.error(getDisplayMessage(error, 'No se pudieron cargar los ítems'));
    }
  }, [type, subjectId, gradeId]);

  useEffect(() => {
    if (open) void fetchItems();
  }, [open, fetchItems]);

  function toggle(item: ItemModel) {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.set(item.id, item);
      }
      return next;
    });
  }

  function handleInsert() {
    if (selected.size === 0) return;
    onInsert([...selected.values()].map(toItemBlock));
    toast.success(
      selected.size === 1 ? 'Pregunta agregada al material.' : `${selected.size} preguntas agregadas al material.`,
    );
    setSelected(new Map());
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSelected(new Map());
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" icon={FileQuestion}>
          Agregar preguntas del banco
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Agregar preguntas del banco</DialogTitle>
          <DialogDescription>
            Cada pregunta se inserta como bloque y queda vinculada al ítem del banco.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-[170px]" aria-label="Tipo de pregunta">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los tipos</SelectItem>
              {ITEM_TYPES.map((option) => (
                <SelectItem key={option} value={option}>
                  {ITEM_TYPE_LABELS[option as ItemType]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={subjectId} onValueChange={setSubjectId}>
            <SelectTrigger className="w-[180px]" aria-label="Asignatura">
              <SelectValue placeholder="Asignatura" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las asignaturas</SelectItem>
              {subjects.map((subject) => (
                <SelectItem key={subject.id} value={subject.id}>
                  {subject.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={gradeId} onValueChange={setGradeId}>
            <SelectTrigger className="w-[150px]" aria-label="Nivel">
              <SelectValue placeholder="Nivel" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los niveles</SelectItem>
              {grades.map((grade) => (
                <SelectItem key={grade.id} value={grade.id}>
                  {grade.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {items === null ? (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          ) : items.length === 0 ? (
            <EmptyState
              icon={FileQuestion}
              title="Sin resultados"
              description="No hay ítems que coincidan con los filtros elegidos."
            />
          ) : (
            items.map((item) => {
              const checked = selected.has(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={checked}
                  onClick={() => toggle(item)}
                  className={
                    checked
                      ? 'flex w-full items-start gap-3 rounded-md border border-primary/60 bg-primary/5 p-3 text-left transition-colors'
                      : 'flex w-full items-start gap-3 rounded-md border border-border p-3 text-left transition-colors hover:bg-muted/40'
                  }
                >
                  {checked ? (
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                  ) : (
                    <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="line-clamp-2 block text-sm">{itemStem(item.content)}</span>
                    <Badge variant="outline">{ITEM_TYPE_LABELS[item.type]}</Badge>
                  </span>
                </button>
              );
            })
          )}
          {items !== null && total > items.length ? (
            <p className="text-xs text-muted-foreground">
              Mostrando {items.length} de {total}. Ajusta los filtros para acotar la búsqueda.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" icon={Plus} disabled={selected.size === 0} onClick={handleInsert}>
            {selected.size > 0 ? `Agregar ${selected.size}` : 'Agregar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
