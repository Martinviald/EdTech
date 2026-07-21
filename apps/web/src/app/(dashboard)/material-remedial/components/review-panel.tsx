'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Pencil, Save, Undo2, X } from 'lucide-react';
import {
  remedialGuideContentSchema,
  remedialPracticeContentSchema,
  remedialPlanContentSchema,
  validateRemedialContent,
  type RemedialContent,
  type RemedialMaterialModel,
} from '@soe/types';
import { Button } from '@/components/ui/button';
import { AlertCallout } from '@/components/shared';
import { reviewRemedial, updateRemedialContent } from '../actions';
import { AI_DISCLAIMER } from './labels';
import { ContentDisplay } from './content-display';
import { GuideEditor } from './guide-editor';
import { PracticeEditor } from './practice-editor';
import { PlanEditor } from './plan-editor';

interface ReviewPanelProps {
  material: RemedialMaterialModel;
  /** Contenido EFECTIVO (editedContent ?? content), ya validado por tipo. */
  content: RemedialContent;
  canApprove: boolean;
}

/**
 * Vista de revisión (estado `ready`, H9.5 + TKT-17 c): muestra el contenido
 * efectivo por tipo, permite editar TODOS los tipos (guía / set de práctica /
 * plan por grupo) antes de aprobar y persistir el override con `PATCH
 * /remedial/:id` (§8.3: la edición va a `editedContent`, la evidencia IA
 * `content` queda intacta), y ofrece aprobar/descartar. Las acciones las autoriza
 * el guard del endpoint (`REMEDIAL_APPROVER_ROLES`); aquí se ocultan si el usuario
 * no puede aprobar.
 */
export function ReviewPanel({ material, content, canApprove }: ReviewPanelProps) {
  const router = useRouter();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RemedialContent>(content);
  const [isSaving, startSave] = useTransition();
  const [isApproving, startApprove] = useTransition();
  const [isDiscarding, startDiscard] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const busy = isSaving || isApproving || isDiscarding;

  function startEditing() {
    setError(null);
    setDraft(content);
    setEditing(true);
  }

  function cancelEditing() {
    setError(null);
    setDraft(content);
    setEditing(false);
  }

  function handleSave() {
    setError(null);
    startSave(async () => {
      try {
        // Validamos el override por tipo antes de persistirlo.
        const validated = validateRemedialContent(material.type, draft);
        await updateRemedialContent({ materialId: material.id, content: validated });
        setEditing(false);
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'El material editado tiene campos inválidos. Revísalo antes de guardar.',
        );
      }
    });
  }

  function handleApprove() {
    setError(null);
    startApprove(async () => {
      try {
        await reviewRemedial({ materialId: material.id, action: 'approve' });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo aprobar el material.');
      }
    });
  }

  function handleDiscard() {
    setError(null);
    startDiscard(async () => {
      try {
        await reviewRemedial({ materialId: material.id, action: 'discard' });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo descartar el material.');
      }
    });
  }

  function renderEditor() {
    switch (material.type) {
      case 'guide': {
        const parsed = remedialGuideContentSchema.safeParse(draft);
        if (!parsed.success) break;
        return <GuideEditor value={parsed.data} onChange={setDraft} disabled={busy} />;
      }
      case 'practice_set': {
        const parsed = remedialPracticeContentSchema.safeParse(draft);
        if (!parsed.success) break;
        return <PracticeEditor value={parsed.data} onChange={setDraft} disabled={busy} />;
      }
      case 'group_plan': {
        const parsed = remedialPlanContentSchema.safeParse(draft);
        if (!parsed.success) break;
        return <PlanEditor value={parsed.data} onChange={setDraft} disabled={busy} />;
      }
    }
    return (
      <AlertCallout tone="danger">
        El contenido del material tiene un formato inesperado y no puede editarse.
      </AlertCallout>
    );
  }

  return (
    <div className="space-y-4">
      <AlertCallout
        tone="warning"
        title="Sugerencia IA — validar antes de aprobar"
        className="no-print"
      >
        {AI_DISCLAIMER}
      </AlertCallout>

      {canApprove ? (
        <div className="flex justify-end no-print">
          {editing ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={cancelEditing}>
              <Undo2 className="size-4" aria-hidden />
              Cancelar edición
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled={busy} onClick={startEditing}>
              <Pencil className="size-4" aria-hidden />
              Editar
            </Button>
          )}
        </div>
      ) : null}

      {editing ? (
        renderEditor()
      ) : (
        <ContentDisplay
          content={content}
          practiceItems={material.practiceItems}
          stimuli={material.stimuli}
          qualityReport={material.qualityReport}
        />
      )}

      {error ? (
        <AlertCallout tone="danger" className="no-print">
          {error}
        </AlertCallout>
      ) : null}

      {canApprove ? (
        <div className="flex flex-col gap-2 no-print sm:flex-row sm:justify-end">
          {editing ? (
            <Button disabled={busy} onClick={handleSave}>
              {isSaving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Save className="size-4" aria-hidden />
              )}
              Guardar cambios
            </Button>
          ) : (
            <>
              <Button variant="secondary" disabled={busy} onClick={handleDiscard}>
                {isDiscarding ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <X className="size-4" aria-hidden />
                )}
                Descartar
              </Button>
              <Button disabled={busy} onClick={handleApprove}>
                {isApproving ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Check className="size-4" aria-hidden />
                )}
                Aprobar
              </Button>
            </>
          )}
        </div>
      ) : (
        <AlertCallout tone="info" className="no-print">
          No tienes permisos para editar, aprobar o descartar este material. Solo puedes revisarlo.
        </AlertCallout>
      )}
    </div>
  );
}
