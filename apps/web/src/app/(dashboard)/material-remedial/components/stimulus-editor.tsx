'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, Loader2, Save } from 'lucide-react';
import {
  updateRemedialStimulusSchema,
  type RemedialStimulus,
  type UpdateRemedialStimulusDto,
} from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCallout } from '@/components/patterns';
import { cn } from '@/lib/utils';
import { updateRemedialStimulus } from '../actions';

/** Mismo estilo de textarea que `item-editor` (no hay componente shadcn `Textarea`). */
const TEXTAREA_CLASS =
  'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

interface StimulusEditorProps {
  stimulus: RemedialStimulus;
  materialId: string;
}

/**
 * Editor del pasaje generado por IA en la revisión (Ola 2.2 · Opción B). "La IA
 * propone, el humano ajusta y aprueba" (CLAUDE.md §8.3): permite editar el título y el
 * texto del estímulo antes de aprobar. Solo se usa para estímulos `ai_generated` (los
 * oficiales de la Opción A son de solo lectura); el gating lo decide `PracticeView`.
 * Valida "texto no vacío" en cliente; el server revalida y puede responder 403 (pasaje
 * oficial) o 400 (material sin stimulus / no `ready`), que se muestran. Tras guardar
 * hace `router.refresh()` para reflejar el material re-hidratado desde el servidor.
 */
export function StimulusEditor({ stimulus, materialId }: StimulusEditorProps) {
  const router = useRouter();

  const [title, setTitle] = useState(stimulus.title ?? '');
  const [text, setText] = useState(stimulus.text ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSave] = useTransition();

  function handleSave() {
    setError(null);

    const trimmedTitle = title.trim();
    const dto: UpdateRemedialStimulusDto = {
      title: trimmedTitle === '' ? null : trimmedTitle,
      text: text.trim(),
    };

    const parsed = updateRemedialStimulusSchema.safeParse(dto);
    if (!parsed.success) {
      setError('El texto del pasaje no puede estar vacío.');
      return;
    }

    startSave(async () => {
      try {
        await updateRemedialStimulus(materialId, parsed.data);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo guardar el pasaje.');
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          Texto de lectura
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={`stimulus-title-${stimulus.sectionId}`}>Título</Label>
          <Input
            id={`stimulus-title-${stimulus.sectionId}`}
            placeholder="Título del texto (opcional)"
            value={title}
            disabled={isSaving}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`stimulus-text-${stimulus.sectionId}`}>Texto</Label>
          <textarea
            id={`stimulus-text-${stimulus.sectionId}`}
            className={cn(TEXTAREA_CLASS, 'min-h-[240px] leading-relaxed')}
            value={text}
            disabled={isSaving}
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        {error ? <AlertCallout tone="danger">{error}</AlertCallout> : null}

        <div className="flex justify-end">
          <Button size="sm" disabled={isSaving} onClick={handleSave}>
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Save className="size-4" aria-hidden />
            )}
            Guardar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
