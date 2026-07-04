'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Pencil, Undo2, X } from 'lucide-react';
import {
  remedialGuideContentSchema,
  remedialPracticeContentSchema,
  remedialPlanContentSchema,
  type RemedialContent,
  type RemedialGuideContent,
  type RemedialMaterialModel,
} from '@soe/types';
import { Button } from '@/components/ui/button';
import { AlertCallout } from '@/components/patterns';
import { reviewRemedial } from '../actions';
import { AI_DISCLAIMER } from './labels';
import { GuideView } from './guide-view';
import { GuideEditor } from './guide-editor';
import { PracticeView } from './practice-view';
import { PlanView } from './plan-view';

interface ReviewPanelProps {
  material: RemedialMaterialModel;
  content: RemedialContent;
  canApprove: boolean;
}

function isGuide(
  type: RemedialMaterialModel['type'],
  content: RemedialContent,
): content is RemedialGuideContent {
  return type === 'guide' && remedialGuideContentSchema.safeParse(content).success;
}

/**
 * Vista de revisión (estado `ready`, H9.5): muestra el contenido por tipo, permite
 * editar la guía antes de aprobar, y ofrece aprobar/descartar. La IA propone; el
 * humano ajusta y aprueba. Las acciones las autoriza el guard del endpoint
 * (`REMEDIAL_APPROVER_ROLES`); aquí se ocultan si el usuario no puede aprobar.
 */
export function ReviewPanel({ material, content, canApprove }: ReviewPanelProps) {
  const router = useRouter();
  const guideContent = isGuide(material.type, content) ? content : null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RemedialGuideContent | null>(guideContent);
  const [isApproving, startApprove] = useTransition();
  const [isDiscarding, startDiscard] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const busy = isApproving || isDiscarding;

  function handleApprove() {
    setError(null);
    startApprove(async () => {
      try {
        // Si se editó la guía, validamos el override antes de enviarlo.
        let edited: RemedialContent | undefined;
        if (editing && draft) {
          const parsed = remedialGuideContentSchema.safeParse(draft);
          if (!parsed.success) {
            setError('La guía editada tiene campos inválidos. Revísala antes de aprobar.');
            return;
          }
          edited = parsed.data;
        }
        await reviewRemedial({
          materialId: material.id,
          action: 'approve',
          content: edited,
        });
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

  function renderContent() {
    if (guideContent) {
      if (editing && draft) {
        return <GuideEditor value={draft} onChange={setDraft} disabled={busy} />;
      }
      return <GuideView content={guideContent} />;
    }
    // Narrowing por schema (el content ya viene validado por tipo desde el servidor).
    const practice = remedialPracticeContentSchema.safeParse(content);
    if (practice.success)
      return <PracticeView content={practice.data} practiceItems={material.practiceItems} />;
    const plan = remedialPlanContentSchema.safeParse(content);
    if (plan.success) return <PlanView content={plan.data} />;
    return (
      <AlertCallout tone="danger">
        El contenido del material tiene un formato inesperado.
      </AlertCallout>
    );
  }

  return (
    <div className="space-y-4">
      <AlertCallout tone="warning" title="Sugerencia IA — validar antes de aprobar">
        {AI_DISCLAIMER}
      </AlertCallout>

      {canApprove && guideContent ? (
        <div className="flex justify-end">
          {editing ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setDraft(guideContent);
              }}
            >
              <Undo2 className="size-4" aria-hidden />
              Cancelar edición
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden />
              Editar
            </Button>
          )}
        </div>
      ) : null}

      {renderContent()}

      {error ? <AlertCallout tone="danger">{error}</AlertCallout> : null}

      {canApprove ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
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
            {editing ? 'Aprobar con cambios' : 'Aprobar'}
          </Button>
        </div>
      ) : (
        <AlertCallout tone="info">
          No tienes permisos para aprobar o descartar este material. Solo puedes revisarlo.
        </AlertCallout>
      )}
    </div>
  );
}
