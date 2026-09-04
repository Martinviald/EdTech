'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Printer } from 'lucide-react';
import {
  createPrintRunSchema,
  type PrintRunAssessmentOption,
  type PrintRunModel,
} from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCallout, Field } from '@/components/shared';
import { DownloadPdfButton } from '../../components/DownloadPdfButton';
import { assessmentLabel } from '../../lib/assessments';
import { createPrintRun } from '../../actions';

export type CourseOption = { id: string; label: string };

/**
 * Valor centinela del selector de evaluación: "crear una nueva". Se manda como
 * `assessmentId: null` y el API crea la evaluación de esta aplicación en papel.
 * Radix Select no admite `value=""` en un item, de ahí el centinela.
 */
const NEW_ASSESSMENT = '__new__';

export type AssessmentFormOption = { id: string; name: string };

export function PrintRunForm({
  layoutId,
  courses,
  assessments,
  assessmentForms = [],
}: {
  layoutId: string;
  courses: CourseOption[];
  assessments: PrintRunAssessmentOption[];
  assessmentForms?: AssessmentFormOption[];
}) {
  const [classGroupId, setClassGroupId] = useState('');
  const [assessmentId, setAssessmentId] = useState<string>(NEW_ASSESSMENT);
  const [assessmentFormId, setAssessmentFormId] = useState('');
  const [spareCount, setSpareCount] = useState('2');
  const [createdRun, setCreatedRun] = useState<PrintRunModel | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const hasForms = assessmentForms.length > 0;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (hasForms && !assessmentFormId) {
      toast.error('Selecciona la forma de la evaluación antes de generar la tirada.');
      return;
    }
    const parsed = createPrintRunSchema.safeParse({
      layoutId,
      classGroupId,
      assessmentId: assessmentId === NEW_ASSESSMENT ? null : assessmentId,
      assessmentFormId: hasForms && assessmentFormId ? assessmentFormId : null,
      spareCount: Number(spareCount),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Datos inválidos');
      return;
    }

    startTransition(async () => {
      const result = await createPrintRun(parsed.data);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setCreatedRun(result.data);
      toast.success(`Tirada creada: ${result.data.sheetCount} hojas listas para imprimir.`);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nueva tirada</CardTitle>
        <CardDescription>
          Se genera una hoja por alumno activo del curso, con su nombre y QR propios, más las
          reservas sin nombre que indiques.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Curso" htmlFor="print-run-course" required>
              <Select value={classGroupId} onValueChange={setClassGroupId} disabled={pending}>
                <SelectTrigger id="print-run-course">
                  <SelectValue placeholder="Selecciona un curso" />
                </SelectTrigger>
                <SelectContent>
                  {courses.map((course) => (
                    <SelectItem key={course.id} value={course.id}>
                      {course.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {hasForms ? (
              <Field
                label="Forma de la evaluación"
                htmlFor="print-run-form"
                required
                hint="Cada tirada corresponde a una sola forma; su hash viaja en el QR y las hojas de otra forma se rechazan al leer."
              >
                <Select
                  value={assessmentFormId}
                  onValueChange={setAssessmentFormId}
                  disabled={pending}
                >
                  <SelectTrigger id="print-run-form">
                    <SelectValue placeholder="Selecciona una forma" />
                  </SelectTrigger>
                  <SelectContent>
                    {assessmentForms.map((form) => (
                      <SelectItem key={form.id} value={form.id}>
                        {form.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}

            <Field
              label="Evaluación"
              htmlFor="print-run-assessment"
              required
              hint="Destino de las respuestas leídas. Si creas una nueva, queda agendada para este curso y este instrumento."
            >
              <Select value={assessmentId} onValueChange={setAssessmentId} disabled={pending}>
                <SelectTrigger id="print-run-assessment">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEW_ASSESSMENT}>Crear una evaluación nueva</SelectItem>
                  {assessments.map((assessment) => (
                    <SelectItem key={assessment.id} value={assessment.id}>
                      {assessmentLabel(assessment)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Hojas de reserva"
              htmlFor="print-run-spare"
              hint="Hojas extra sin alumno asignado, para incorporaciones o reemplazos (0–20)."
            >
              <Input
                id="print-run-spare"
                type="number"
                min={0}
                max={20}
                value={spareCount}
                onChange={(e) => setSpareCount(e.target.value)}
                disabled={pending}
              />
            </Field>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={pending || !classGroupId || (hasForms && !assessmentFormId)}>
              {pending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Generando…
                </>
              ) : (
                <>
                  <Printer className="mr-2 size-4" />
                  Generar tirada
                </>
              )}
            </Button>
          </div>
        </form>

        {createdRun ? (
          <AlertCallout tone="success" title="Tirada creada">
            <div className="space-y-3">
              <p>
                {createdRun.sheetCount} hojas para{' '}
                <span className="font-medium">{createdRun.classGroupName ?? 'el curso'}</span> (
                {createdRun.spareCount} de reserva). Descarga el PDF e imprímelo sin ajustar a
                página.
              </p>
              <DownloadPdfButton runId={createdRun.id} variant="default" size="default" />
            </div>
          </AlertCallout>
        ) : null}
      </CardContent>
    </Card>
  );
}
