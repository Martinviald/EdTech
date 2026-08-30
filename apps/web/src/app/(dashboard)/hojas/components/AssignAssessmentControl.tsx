'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import type { PrintRunAssessmentOption } from '@soe/types';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { updatePrintRunAssessment } from '../actions';
import { assessmentLabel } from '../lib/assessments';

/**
 * Asocia una evaluación a una tirada que no la tiene. Las tiradas creadas antes
 * del selector de evaluación nacieron con `assessmentId: null` y su lote nunca
 * podía confirmarse; este control es el camino de reparación.
 */
export function AssignAssessmentControl({
  runId,
  assessments,
}: {
  runId: string;
  assessments: PrintRunAssessmentOption[];
}) {
  const [assessmentId, setAssessmentId] = useState('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSave() {
    if (!assessmentId) return;
    startTransition(async () => {
      const result = await updatePrintRunAssessment(runId, assessmentId);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success('Evaluación asociada a la tirada.');
      router.refresh();
    });
  }

  if (assessments.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">
        Sin evaluaciones de este instrumento para asociar
      </span>
    );
  }

  return (
    <div className="flex items-center justify-end gap-2">
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
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" onClick={handleSave} disabled={pending || !assessmentId}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : 'Asociar'}
      </Button>
    </div>
  );
}
