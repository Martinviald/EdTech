'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ImageOff, Loader2, Pencil } from 'lucide-react';
import type { ReviewMarkDto, ReviewMarkModel } from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCallout } from '@/components/shared';
import { useBatchCorrections, useCorrectMark } from '../../../hooks/use-review-queue';
import { MarkReviewPanel } from './MarkReviewPanel';
import { markOriginLabel } from './review-labels';

/** Decisión vigente de la marca, en palabras del profesor. */
export function currentDecisionLabel(mark: ReviewMarkModel): string {
  switch (mark.reviewedDecision) {
    case 'option':
      return `Alternativa ${mark.reviewedValue ?? ''}`.trim();
    case 'blank':
      return 'En blanco';
    case 'annulled':
      return 'Anulada';
    default:
      return 'Sin decisión';
  }
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function filterCorrectionMarks(
  marks: ReviewMarkModel[],
  student: string,
  question: string,
): ReviewMarkModel[] {
  const studentQuery = normalize(student);
  const questionQuery = normalize(question);
  return marks.filter(
    (mark) =>
      (studentQuery === '' || normalize(mark.studentName ?? '').includes(studentQuery)) &&
      (questionQuery === '' || normalize(mark.printedNumber) === questionQuery),
  );
}

export function CorrectionsSection({ batchId }: { batchId: string }) {
  const { data, isPending, isError } = useBatchCorrections(batchId, true);
  const correct = useCorrectMark(batchId);
  const [student, setStudent] = useState('');
  const [question, setQuestion] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const marks = useMemo(() => data?.marks ?? [], [data]);
  const visible = useMemo(
    () => filterCorrectionMarks(marks, student, question),
    [marks, student, question],
  );
  const editing = marks.find((mark) => mark.markId === editingId) ?? null;

  const handleResolve = (markId: string, decision: ReviewMarkDto) => {
    correct.mutate(
      { markId, decision },
      {
        onSuccess: () => {
          toast.success('Respuesta corregida. Los resultados del alumno se recalcularon.');
          setEditingId(null);
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Corregir una respuesta</CardTitle>
        <CardDescription>
          Si un alumno reclama una respuesta, búscalo, mira el recorte de su hoja y corrígela. Sus
          resultados se recalculan al guardar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <div className="space-y-1.5">
            <Label htmlFor="correction-student">Alumno</Label>
            <Input
              id="correction-student"
              value={student}
              onChange={(e) => setStudent(e.target.value)}
              placeholder="Busca por nombre"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="correction-question">Pregunta</Label>
            <Input
              id="correction-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="N.º"
              inputMode="numeric"
            />
          </div>
        </div>

        {isPending && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Cargando las marcas del lote
          </p>
        )}
        {isError && (
          <AlertCallout tone="danger" title="No se pudieron cargar las marcas">
            Vuelve a abrir la página para intentarlo otra vez.
          </AlertCallout>
        )}
        {!isPending && !isError && marks.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Este lote no tuvo marcas dudosas: no hay respuestas que corregir desde aquí.
          </p>
        )}
        {marks.length > 0 && visible.length === 0 && (
          <p className="text-sm text-muted-foreground">Ninguna marca coincide con el filtro.</p>
        )}

        <ul className="divide-y rounded-lg border">
          {visible.map((mark) => {
            const origin = markOriginLabel(mark);
            return (
              <li
                key={mark.markId}
                className="flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap"
              >
                <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-md border bg-muted/40">
                  {mark.cropUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={mark.cropUrl}
                      alt={`Recorte de la pregunta ${mark.printedNumber}`}
                      className="max-h-full max-w-full rounded bg-card"
                    />
                  ) : (
                    <ImageOff className="size-5 text-muted-foreground" aria-hidden />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1 text-sm">
                  <p className="truncate font-medium text-foreground">
                    {mark.studentName ?? 'Alumno sin identificar'}
                  </p>
                  <p className="text-muted-foreground">
                    Pregunta {mark.printedNumber} · {currentDecisionLabel(mark)}
                  </p>
                  {origin && (
                    <span className="inline-block rounded-full bg-info/10 px-2 py-0.5 text-xs font-medium text-info">
                      {origin}
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditingId(mark.markId)}
                  aria-label={`Corregir la pregunta ${mark.printedNumber} de ${mark.studentName ?? 'un alumno sin identificar'}`}
                >
                  <Pencil className="mr-2 size-4" aria-hidden />
                  Corregir
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditingId(null)}>
        <DialogContent className="max-w-3xl">
          <DialogTitle className="sr-only">Corregir la respuesta</DialogTitle>
          <DialogDescription className="sr-only">
            Elige la respuesta correcta del alumno para esta pregunta.
          </DialogDescription>
          {editing && (
            <MarkReviewPanel
              batchId={batchId}
              marks={[editing]}
              quickConfirm={false}
              variant="correction"
              onResolve={handleResolve}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
