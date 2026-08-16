'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import {
  ITEM_TYPE_LABELS,
  multipleChoiceContentSchema,
  openEndedContentSchema,
  shortAnswerContentSchema,
  trueFalseContentSchema,
  type Block,
  type DocumentModel,
} from '@soe/types';
import { apiClientPost } from '@/lib/api-client';
import { getDisplayMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, AlertCallout } from '@/components/shared';

type ItemBlockType = Extract<Block, { type: 'item' }>;

type ChoiceDraft = {
  stem: string;
  alternatives: Array<{ key: string; text: string; isCorrect: boolean }>;
  explanation: string;
};

type CustomizeItemDialogProps = {
  documentId: string;
  block: ItemBlockType | null;
  onClose: () => void;
  onSaved: (document: DocumentModel) => void;
};

const EDITABLE_TYPES = new Set(['multiple_choice', 'multi_select', 'true_false', 'short_answer', 'open_ended']);

/**
 * Edición de contenido de un ítem desde el canvas. El backend aplica la regla
 * copy-on-write (Decisión H): si el ítem no es propio lo clona a un draft de la
 * org y re-apunta el bloque; el original queda intacto.
 */
export function CustomizeItemDialog({
  documentId,
  block,
  onClose,
  onSaved,
}: CustomizeItemDialogProps) {
  const [isSaving, setIsSaving] = useState(false);

  async function save(content: Record<string, unknown>) {
    if (!block) return;
    setIsSaving(true);
    try {
      const updated = await apiClientPost<DocumentModel>(
        `/documents/${documentId}/items/${block.itemId}/customize`,
        { blockId: block.id, content },
      );
      toast.success('Pregunta actualizada en este material.');
      onSaved(updated);
      onClose();
    } catch (error) {
      toast.error(getDisplayMessage(error, 'No se pudo guardar la pregunta'));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={block !== null} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Editar pregunta</DialogTitle>
          <DialogDescription>
            Los cambios aplican a este material: si la pregunta es del banco compartido, se crea
            tu propia versión y el original queda intacto.
          </DialogDescription>
        </DialogHeader>
        {block ? (
          EDITABLE_TYPES.has(block.snapshot.type) ? (
            <CustomizeForm key={block.id} block={block} isSaving={isSaving} onSubmit={save} />
          ) : (
            <AlertCallout tone="info" title="Edición no disponible en el editor">
              Las preguntas de tipo {ITEM_TYPE_LABELS[block.snapshot.type]} se editan en el banco
              de contenido.
            </AlertCallout>
          )
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CustomizeForm({
  block,
  isSaving,
  onSubmit,
}: {
  block: ItemBlockType;
  isSaving: boolean;
  onSubmit: (content: Record<string, unknown>) => void;
}) {
  switch (block.snapshot.type) {
    case 'multiple_choice':
    case 'multi_select':
      return <ChoiceForm block={block} isSaving={isSaving} onSubmit={onSubmit} />;
    case 'true_false':
      return <TrueFalseForm block={block} isSaving={isSaving} onSubmit={onSubmit} />;
    case 'short_answer':
      return <ShortAnswerForm block={block} isSaving={isSaving} onSubmit={onSubmit} />;
    case 'open_ended':
      return <OpenEndedForm block={block} isSaving={isSaving} onSubmit={onSubmit} />;
    default:
      return null;
  }
}

type FormProps = {
  block: ItemBlockType;
  isSaving: boolean;
  onSubmit: (content: Record<string, unknown>) => void;
};

function SaveFooter({ isSaving }: { isSaving: boolean }) {
  return (
    <DialogFooter>
      <Button type="submit" disabled={isSaving}>
        {isSaving ? 'Guardando…' : 'Guardar cambios'}
      </Button>
    </DialogFooter>
  );
}

function ChoiceForm({ block, isSaving, onSubmit }: FormProps) {
  const [draft, setDraft] = useState<ChoiceDraft>({ stem: '', alternatives: [], explanation: '' });

  useEffect(() => {
    const parsed = multipleChoiceContentSchema.safeParse(block.snapshot.content);
    if (parsed.success) {
      setDraft({
        stem: parsed.data.stem,
        alternatives: parsed.data.alternatives.map((alt) => ({ ...alt })),
        explanation: parsed.data.explanation ?? '',
      });
    }
  }, [block]);

  const isMultiSelect = block.snapshot.type === 'multi_select';

  function updateAlternative(index: number, patch: Partial<ChoiceDraft['alternatives'][number]>) {
    setDraft((current) => ({
      ...current,
      alternatives: current.alternatives.map((alt, i) =>
        i === index
          ? { ...alt, ...patch }
          : isMultiSelect || patch.isCorrect !== true
            ? alt
            : { ...alt, isCorrect: false },
      ),
    }));
  }

  function addAlternative() {
    setDraft((current) => {
      const nextKey = String.fromCharCode(65 + current.alternatives.length);
      return {
        ...current,
        alternatives: [...current.alternatives, { key: nextKey, text: '', isCorrect: false }],
      };
    });
  }

  function removeAlternative(index: number) {
    setDraft((current) => ({
      ...current,
      alternatives: current.alternatives
        .filter((_, i) => i !== index)
        .map((alt, i) => ({ ...alt, key: String.fromCharCode(65 + i) })),
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.stem.trim()) {
      toast.error('El enunciado no puede quedar vacío.');
      return;
    }
    if (draft.alternatives.length < 2) {
      toast.error('Agrega al menos dos alternativas.');
      return;
    }
    if (!draft.alternatives.some((alt) => alt.isCorrect)) {
      toast.error('Marca al menos una alternativa correcta.');
      return;
    }
    onSubmit({
      stem: draft.stem.trim(),
      alternatives: draft.alternatives.map((alt) => ({
        key: alt.key,
        text: alt.text.trim(),
        isCorrect: alt.isCorrect,
      })),
      ...(draft.explanation.trim() ? { explanation: draft.explanation.trim() } : {}),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Enunciado" htmlFor="customize-stem" required>
        <Textarea
          id="customize-stem"
          value={draft.stem}
          rows={3}
          onChange={(e) => setDraft((current) => ({ ...current, stem: e.target.value }))}
        />
      </Field>

      <div className="space-y-2">
        <p className="text-sm font-medium">
          Alternativas{' '}
          <span className="text-muted-foreground font-normal">
            ({isMultiSelect ? 'marca todas las correctas' : 'marca la correcta'})
          </span>
        </p>
        {draft.alternatives.map((alt, index) => (
          <div key={index} className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={alt.isCorrect ? 'secondary' : 'outline'}
              className="w-10 shrink-0 font-semibold"
              aria-label={`Marcar ${alt.key} como correcta`}
              onClick={() => updateAlternative(index, { isCorrect: !alt.isCorrect })}
            >
              {alt.key}
            </Button>
            <Input
              value={alt.text}
              aria-label={`Texto alternativa ${alt.key}`}
              onChange={(e) => updateAlternative(index, { text: e.target.value })}
            />
            {alt.isCorrect ? <Badge variant="success">Correcta</Badge> : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              aria-label={`Eliminar alternativa ${alt.key}`}
              disabled={draft.alternatives.length <= 2}
              onClick={() => removeAlternative(index)}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          icon={Plus}
          disabled={draft.alternatives.length >= 8}
          onClick={addAlternative}
        >
          Agregar alternativa
        </Button>
      </div>

      <Field label="Explicación (opcional)" htmlFor="customize-explanation">
        <Textarea
          id="customize-explanation"
          value={draft.explanation}
          rows={2}
          onChange={(e) => setDraft((current) => ({ ...current, explanation: e.target.value }))}
        />
      </Field>
      <SaveFooter isSaving={isSaving} />
    </form>
  );
}

function TrueFalseForm({ block, isSaving, onSubmit }: FormProps) {
  const [stem, setStem] = useState('');
  const [correctAnswer, setCorrectAnswer] = useState(true);
  const [explanation, setExplanation] = useState('');

  useEffect(() => {
    const parsed = trueFalseContentSchema.safeParse(block.snapshot.content);
    if (parsed.success) {
      setStem(parsed.data.stem);
      setCorrectAnswer(parsed.data.correctAnswer);
      setExplanation(parsed.data.explanation ?? '');
    }
  }, [block]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stem.trim()) {
      toast.error('El enunciado no puede quedar vacío.');
      return;
    }
    onSubmit({
      stem: stem.trim(),
      correctAnswer,
      ...(explanation.trim() ? { explanation: explanation.trim() } : {}),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Enunciado" htmlFor="customize-tf-stem" required>
        <Textarea
          id="customize-tf-stem"
          value={stem}
          rows={3}
          onChange={(e) => setStem(e.target.value)}
        />
      </Field>
      <Field label="Respuesta correcta" htmlFor="customize-tf-answer">
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={correctAnswer ? 'secondary' : 'outline'}
            onClick={() => setCorrectAnswer(true)}
          >
            Verdadero
          </Button>
          <Button
            type="button"
            size="sm"
            variant={!correctAnswer ? 'secondary' : 'outline'}
            onClick={() => setCorrectAnswer(false)}
          >
            Falso
          </Button>
        </div>
      </Field>
      <Field label="Explicación (opcional)" htmlFor="customize-tf-explanation">
        <Textarea
          id="customize-tf-explanation"
          value={explanation}
          rows={2}
          onChange={(e) => setExplanation(e.target.value)}
        />
      </Field>
      <SaveFooter isSaving={isSaving} />
    </form>
  );
}

function ShortAnswerForm({ block, isSaving, onSubmit }: FormProps) {
  const [prompt, setPrompt] = useState('');
  const [answers, setAnswers] = useState('');
  const [unit, setUnit] = useState('');

  useEffect(() => {
    const parsed = shortAnswerContentSchema.safeParse(block.snapshot.content);
    if (parsed.success) {
      setPrompt(parsed.data.prompt);
      setAnswers(parsed.data.acceptedAnswers.join(', '));
      setUnit(parsed.data.unit ?? '');
    }
  }, [block]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const acceptedAnswers = answers
      .split(',')
      .map((answer) => answer.trim())
      .filter((answer) => answer.length > 0);
    if (!prompt.trim()) {
      toast.error('La pregunta no puede quedar vacía.');
      return;
    }
    if (acceptedAnswers.length === 0) {
      toast.error('Indica al menos una respuesta aceptada.');
      return;
    }
    onSubmit({
      prompt: prompt.trim(),
      acceptedAnswers,
      ...(unit.trim() ? { unit: unit.trim() } : {}),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Pregunta" htmlFor="customize-sa-prompt" required>
        <Textarea
          id="customize-sa-prompt"
          value={prompt}
          rows={3}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </Field>
      <Field
        label="Respuestas aceptadas"
        htmlFor="customize-sa-answers"
        hint="Separadas por coma."
        required
      >
        <Input
          id="customize-sa-answers"
          value={answers}
          onChange={(e) => setAnswers(e.target.value)}
        />
      </Field>
      <Field label="Unidad (opcional)" htmlFor="customize-sa-unit">
        <Input
          id="customize-sa-unit"
          value={unit}
          className="w-40"
          onChange={(e) => setUnit(e.target.value)}
        />
      </Field>
      <SaveFooter isSaving={isSaving} />
    </form>
  );
}

function OpenEndedForm({ block, isSaving, onSubmit }: FormProps) {
  const [prompt, setPrompt] = useState('');
  const [sampleAnswer, setSampleAnswer] = useState('');

  useEffect(() => {
    const parsed = openEndedContentSchema.safeParse(block.snapshot.content);
    if (parsed.success) {
      setPrompt(parsed.data.prompt);
      setSampleAnswer(parsed.data.sampleAnswer ?? '');
    }
  }, [block]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) {
      toast.error('La pregunta no puede quedar vacía.');
      return;
    }
    onSubmit({
      prompt: prompt.trim(),
      ...(sampleAnswer.trim() ? { sampleAnswer: sampleAnswer.trim() } : {}),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Pregunta" htmlFor="customize-oe-prompt" required>
        <Textarea
          id="customize-oe-prompt"
          value={prompt}
          rows={3}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </Field>
      <Field label="Respuesta modelo (opcional)" htmlFor="customize-oe-sample">
        <Textarea
          id="customize-oe-sample"
          value={sampleAnswer}
          rows={4}
          onChange={(e) => setSampleAnswer(e.target.value)}
        />
      </Field>
      <SaveFooter isSaving={isSaving} />
    </form>
  );
}
