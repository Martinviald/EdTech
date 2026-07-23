'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Sección de drill-down por-pregunta (H20.8). Permite elegir cualquier pregunta
// de la evaluación (o saltar directo desde un ítem crítico) y abrir el modal de
// análisis IA por-pregunta (`ItemInsightDialog`). Mapea posición → itemId con las
// columnas de la matriz (item-analysis), que sí traen el itemId del ítem.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import { Search, Sparkles } from 'lucide-react';
import type { MatrixQuestionColumn, UserRole } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ItemInsightDialog, type ItemInsightTarget } from './item-insight-dialog';

interface ItemInsightSectionProps {
  questions: MatrixQuestionColumn[];
  assessmentId: string;
  classGroupId?: string;
  activeRole: UserRole;
}

export function ItemInsightSection({
  questions,
  assessmentId,
  classGroupId,
  activeRole,
}: ItemInsightSectionProps) {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<ItemInsightTarget | null>(null);

  const sorted = useMemo(
    () => [...questions].sort((a, b) => a.position - b.position),
    [questions],
  );

  function openForQuestion(q: MatrixQuestionColumn) {
    setTarget({
      itemId: q.itemId,
      position: q.position,
      skillName: q.skill?.nodeName ?? null,
    });
    setOpen(true);
  }

  const selected = sorted.find((q) => q.itemId === selectedId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-5 text-primary" aria-hidden />
          Análisis IA por pregunta
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {sorted.length === 0 ? (
          <EmptyState
            icon={Search}
            title="Sin preguntas disponibles"
            description="No hay preguntas con respuestas registradas para profundizar."
          />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Profundiza en una pregunta para entender por qué se obtuvo ese
              resultado: causa probable, lectura de distractores, pasaje o imagen
              asociada y calidad del ítem.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1">
                <label
                  htmlFor="item-insight-select"
                  className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  Elegir pregunta
                </label>
                <Select value={selectedId} onValueChange={setSelectedId}>
                  <SelectTrigger id="item-insight-select" className="w-full">
                    <SelectValue placeholder="Selecciona una pregunta…" />
                  </SelectTrigger>
                  <SelectContent>
                    {sorted.map((q) => (
                      <SelectItem key={q.itemId} value={q.itemId}>
                        Pregunta {q.position}
                        {q.skill?.nodeName ? ` · ${q.skill.nodeName}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                disabled={!selected}
                onClick={() => selected && openForQuestion(selected)}
              >
                <Sparkles className="size-4" aria-hidden />
                Analizar con IA
              </Button>
            </div>
          </>
        )}
      </CardContent>

      <ItemInsightDialog
        open={open}
        onOpenChange={setOpen}
        target={target}
        assessmentId={assessmentId}
        classGroupId={classGroupId}
        activeRole={activeRole}
      />
    </Card>
  );
}
