'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Link2, Loader2 } from 'lucide-react';
import type { ProcessCandidateAssessment } from '@soe/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/shared';
import { linkProcessAssessments } from '../../actions';

export function LinkAssessmentsDialog({
  processId,
  candidates,
}: {
  processId: string;
  candidates: readonly ProcessCandidateAssessment[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(assessmentId: string) {
    setSelected((current) =>
      current.includes(assessmentId)
        ? current.filter((id) => id !== assessmentId)
        : [...current, assessmentId],
    );
  }

  function handleLink() {
    if (selected.length === 0) {
      toast.error('Elige al menos una evaluación.');
      return;
    }
    startTransition(async () => {
      const result = await linkProcessAssessments(processId, {
        assessmentIds: selected,
        action: 'link',
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(`${result.data.linked} evaluación(es) asociadas al proceso.`);
      setSelected([]);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Link2 className="mr-2 size-4" aria-hidden />
          Asociar evaluaciones
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Asociar evaluaciones al proceso</DialogTitle>
          <DialogDescription>
            Evaluaciones del mismo año académico. Las que ya pertenecen a otro proceso se mueven a
            este.
          </DialogDescription>
        </DialogHeader>

        {candidates.length === 0 ? (
          <EmptyState
            size="sm"
            title="No hay evaluaciones disponibles"
            description="Todas las evaluaciones del año ya pertenecen a este proceso."
          />
        ) : (
          <ul className="divide-y">
            {candidates.map((candidate) => (
              <li key={candidate.assessmentId}>
                <label className="hover:bg-muted/50 flex cursor-pointer items-start gap-3 px-1 py-2.5">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 shrink-0"
                    checked={selected.includes(candidate.assessmentId)}
                    onChange={() => toggle(candidate.assessmentId)}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {candidate.assessmentName ?? candidate.instrumentName}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {[
                        candidate.subjectName,
                        candidate.classGroupNames.join(', '),
                        candidate.currentProcessId ? 'ya asociada a otro proceso' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleLink} disabled={pending || selected.length === 0}>
            {pending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
            Asociar {selected.length > 0 ? `(${selected.length})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
