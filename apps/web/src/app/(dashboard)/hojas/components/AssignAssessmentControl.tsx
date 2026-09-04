'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Plus } from 'lucide-react';
import type { PrintRunAssessmentOption } from '@soe/types';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createPrintRunAssessment, updatePrintRunAssessment } from '../actions';
import { assessmentLabel } from '../lib/assessments';

const CREATE_OPTION = '__create__';

/**
 * Asocia una evaluación a una tirada que no la tiene. Las tiradas creadas antes
 * del selector de evaluación nacieron con `assessmentId: null` y su lote nunca
 * podía confirmarse; este control es el camino de reparación.
 *
 * Siempre ofrece crear una evaluación nueva para el instrumento: si no existe
 * ninguna candidata, elegir de una lista vacía no era una salida, y el
 * autocreado del backend sólo corre al crear la tirada.
 */
export function AssignAssessmentControl({
  runId,
  assessments,
}: {
  runId: string;
  assessments: PrintRunAssessmentOption[];
}) {
  const [assessmentId, setAssessmentId] = useState(assessments.length === 0 ? CREATE_OPTION : '');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSave() {
    if (!assessmentId) return;
    startTransition(async () => {
      const result =
        assessmentId === CREATE_OPTION
          ? await createPrintRunAssessment(runId)
          : await updatePrintRunAssessment(runId, assessmentId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(
        assessmentId === CREATE_OPTION
          ? 'Evaluación creada y asociada a la tirada.'
          : 'Evaluación asociada a la tirada.',
      );
      router.refresh();
    });
  }

  if (assessments.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          Este instrumento aún no tiene evaluaciones.
        </span>
        <Button size="sm" variant="outline" onClick={handleSave} disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              <Plus className="mr-2 size-4" aria-hidden />
              Crear evaluación y asociar
            </>
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={assessmentId} onValueChange={setAssessmentId} disabled={pending}>
        <SelectTrigger className="h-8 w-56" aria-label="Evaluación de la tirada">
          <SelectValue placeholder="Asociar evaluación" />
        </SelectTrigger>
        <SelectContent>
          {assessments.map((assessment) => (
            <SelectItem key={assessment.id} value={assessment.id}>
              {assessmentLabel(assessment)}
            </SelectItem>
          ))}
          <SelectItem value={CREATE_OPTION}>Crear una evaluación nueva</SelectItem>
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" onClick={handleSave} disabled={pending || !assessmentId}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : 'Asociar'}
      </Button>
    </div>
  );
}
