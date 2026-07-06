'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Save, Trash2 } from 'lucide-react';
import {
  updateRemedialItemSchema,
  type RemedialPracticeItemPreview,
  type UpdateRemedialItemDto,
} from '@soe/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCallout } from '@/components/patterns';
import { cn } from '@/lib/utils';
import { removeRemedialItem, updateRemedialItem } from '../actions';

const POSITION_BADGE =
  'mt-0.5 shrink-0 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary';

/** Mismo estilo de textarea que `guide-editor` (no hay componente shadcn `Textarea`). */
const TEXTAREA_CLASS =
  'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

interface EditableAlternative {
  key: string;
  text: string;
  isCorrect: boolean;
}

interface ItemEditorProps {
  item: RemedialPracticeItemPreview;
  materialId: string;
  /**
   * Flag del juez automático para esta posición (Ola 2.1b), renderizado sobre los
   * campos igual que en la vista de lectura. Ausente ⇒ no se muestra flag. Se recibe
   * ya renderizado para no acoplar el editor al shape del veredicto.
   */
  flag?: ReactNode;
}

/**
 * Deriva el estado editable inicial desde el preview hidratado. La "correcta" se
 * resuelve por `isCorrect` o por `correctKey` (misma lógica que la vista de lectura).
 */
function toEditableAlternatives(item: RemedialPracticeItemPreview): EditableAlternative[] {
  return (item.alternatives ?? []).map((alt) => ({
    key: alt.key,
    text: alt.text,
    isCorrect: alt.isCorrect || (item.correctKey != null && alt.key === item.correctKey),
  }));
}

/**
 * Editor inline de un ítem de práctica en la revisión (Ola 1-resto G2). "La IA
 * propone, el humano ajusta y aprueba" (CLAUDE.md §8.3): permite editar enunciado,
 * texto de cada alternativa, cuál es la correcta (radio) y explicación, o quitar el
 * ítem del set. Valida "exactamente una correcta" en cliente; el server revalida y
 * puede responder 400 (se muestra). Tras guardar/quitar hace `router.refresh()` para
 * reflejar la hidratación actualizada desde `items`.
 *
 * Conserva el `flag` del juez (Ola 2.1b) sobre los campos: la revisión editable no
 * pierde el veredicto por ítem que aporta la vista de lectura.
 */
export function ItemEditor({ item, materialId, flag }: ItemEditorProps) {
  const router = useRouter();

  const [stem, setStem] = useState(item.stem ?? '');
  const [alternatives, setAlternatives] = useState<EditableAlternative[]>(() =>
    toEditableAlternatives(item),
  );
  const [explanation, setExplanation] = useState(item.explanation ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const [isSaving, startSave] = useTransition();
  const [isRemoving, startRemove] = useTransition();
  const busy = isSaving || isRemoving;

  const correctCount = alternatives.filter((alt) => alt.isCorrect).length;

  function setAltText(key: string, text: string) {
    setAlternatives((prev) => prev.map((alt) => (alt.key === key ? { ...alt, text } : alt)));
  }

  function markCorrect(key: string) {
    setAlternatives((prev) => prev.map((alt) => ({ ...alt, isCorrect: alt.key === key })));
  }

  function handleSave() {
    setError(null);

    // Validación en cliente: exactamente una correcta (el server revalida → 400).
    if (correctCount !== 1) {
      setError('Marca exactamente una alternativa como correcta.');
      return;
    }

    const dto: UpdateRemedialItemDto = {
      stem: stem.trim(),
      alternatives: alternatives.map((alt) => ({
        key: alt.key,
        text: alt.text.trim(),
        isCorrect: alt.isCorrect,
      })),
      explanation: explanation.trim() === '' ? null : explanation.trim(),
    };

    const parsed = updateRemedialItemSchema.safeParse(dto);
    if (!parsed.success) {
      setError('El enunciado y el texto de cada alternativa no pueden estar vacíos.');
      return;
    }

    startSave(async () => {
      try {
        await updateRemedialItem(materialId, item.itemId, parsed.data);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo guardar el ítem.');
      }
    });
  }

  function handleRemove() {
    setError(null);
    startRemove(async () => {
      try {
        await removeRemedialItem(materialId, item.itemId);
        router.refresh();
      } catch (err) {
        setConfirmingRemove(false);
        setError(err instanceof Error ? err.message : 'No se pudo quitar el ítem.');
      }
    });
  }

  return (
    <li className="rounded-md border bg-muted/30 p-3 sm:p-4">
      <div className="flex items-start gap-2">
        <span className={POSITION_BADGE}>{item.position}</span>
        <div className="min-w-0 flex-1 space-y-4">
          {flag}

          <div className="space-y-1.5">
            <Label htmlFor={`stem-${item.itemId}`}>Enunciado</Label>
            <textarea
              id={`stem-${item.itemId}`}
              className={TEXTAREA_CLASS}
              value={stem}
              disabled={busy}
              onChange={(e) => setStem(e.target.value)}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="mb-1.5 text-sm font-medium leading-none">
              Alternativas{' '}
              <span className="font-normal text-muted-foreground">(marca la correcta)</span>
            </legend>
            {alternatives.length === 0 ? (
              <p className="text-sm text-muted-foreground">Este ítem no tiene alternativas.</p>
            ) : (
              alternatives.map((alt) => (
                <div
                  key={alt.key}
                  className={cn(
                    'flex items-center gap-2 rounded-md border px-2.5 py-1.5',
                    alt.isCorrect
                      ? 'border-success/40 bg-success/10'
                      : 'border-border bg-background',
                  )}
                >
                  <input
                    type="radio"
                    name={`correct-${item.itemId}`}
                    aria-label={`Marcar la alternativa ${alt.key} como correcta`}
                    className="size-4 shrink-0 accent-primary"
                    checked={alt.isCorrect}
                    disabled={busy}
                    onChange={() => markCorrect(alt.key)}
                  />
                  <span className="w-5 shrink-0 text-sm font-medium text-foreground">
                    {alt.key})
                  </span>
                  <Input
                    aria-label={`Texto de la alternativa ${alt.key}`}
                    className="h-9"
                    value={alt.text}
                    disabled={busy}
                    onChange={(e) => setAltText(alt.key, e.target.value)}
                  />
                </div>
              ))
            )}
            {correctCount !== 1 ? (
              <p className="text-xs text-destructive">
                Debe haber exactamente una alternativa correcta.
              </p>
            ) : null}
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor={`explanation-${item.itemId}`}>Explicación</Label>
            <textarea
              id={`explanation-${item.itemId}`}
              className={TEXTAREA_CLASS}
              placeholder="Explicación de la respuesta correcta (opcional)"
              value={explanation}
              disabled={busy}
              onChange={(e) => setExplanation(e.target.value)}
            />
          </div>

          {error ? <AlertCallout tone="danger">{error}</AlertCallout> : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {confirmingRemove ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">¿Quitar este ítem del set?</span>
                <Button variant="destructive" size="sm" disabled={busy} onClick={handleRemove}>
                  {isRemoving ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="size-4" aria-hidden />
                  )}
                  Confirmar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirmingRemove(false)}
                >
                  Cancelar
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => setConfirmingRemove(true)}
              >
                <Trash2 className="size-4" aria-hidden />
                Quitar
              </Button>
            )}

            <Button size="sm" disabled={busy} onClick={handleSave}>
              {isSaving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Save className="size-4" aria-hidden />
              )}
              Guardar
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}
