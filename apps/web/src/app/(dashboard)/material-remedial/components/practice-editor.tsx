'use client';

import type { RemedialPracticeContent } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const textareaClass =
  'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

interface PracticeEditorProps {
  value: RemedialPracticeContent;
  onChange: (next: RemedialPracticeContent) => void;
  disabled?: boolean;
}

/**
 * Editor de un set de práctica (TKT-17 c). Permite ajustar la habilidad
 * focalizada, las notas docentes y el enunciado (preview) de cada ítem. El
 * `itemId` y la posición no se editan (referencian ítems reales del banco). El
 * override humano se persiste en `editedContent`; la salida IA queda intacta.
 */
export function PracticeEditor({ value, onChange, disabled }: PracticeEditorProps) {
  function patchItem(idx: number, stem: string) {
    const items = value.items.map((item, i) => (i === idx ? { ...item, stem } : item));
    onChange({ ...value, items });
  }

  const items = [...value.items].sort((a, b) => a.position - b.position);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Habilidad focalizada</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={value.skillFocus}
            placeholder="Habilidad focalizada"
            disabled={disabled}
            onChange={(e) => onChange({ ...value, skillFocus: e.target.value })}
          />
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Notas para el profesor</Label>
            <textarea
              className={textareaClass}
              value={value.notes ?? ''}
              placeholder="Notas docentes (opcional)"
              disabled={disabled}
              onChange={(e) =>
                onChange({ ...value, notes: e.target.value === '' ? null : e.target.value })
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ítems de práctica (borrador)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay ítems en este set.</p>
          ) : (
            items.map((item) => {
              const idx = value.items.indexOf(item);
              return (
                <div key={item.itemId} className="space-y-2 rounded-md border bg-muted/20 p-3">
                  <span className="inline-block rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    Ítem {item.position}
                  </span>
                  <textarea
                    className={textareaClass}
                    value={item.stem}
                    placeholder="Enunciado del ítem"
                    disabled={disabled}
                    onChange={(e) => patchItem(idx, e.target.value)}
                  />
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
