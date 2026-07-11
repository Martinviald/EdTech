'use client';

import type { RemedialPlanContent } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const textareaClass =
  'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

interface PlanEditorProps {
  value: RemedialPlanContent;
  onChange: (next: RemedialPlanContent) => void;
  disabled?: boolean;
}

/**
 * Editor de un plan por grupo (TKT-17 c). Permite ajustar la etiqueta del grupo,
 * la brecha compartida, las sesiones estimadas y cada paso de la secuencia. El
 * `studentCount` es determinista (backend) y el `linkedNodeId` referencia un OA,
 * por lo que no se editan aquí. El override se persiste en `editedContent`.
 */
export function PlanEditor({ value, onChange, disabled }: PlanEditorProps) {
  function patchStep(idx: number, partial: Partial<RemedialPlanContent['sequence'][number]>) {
    const sequence = value.sequence.map((s, i) => (i === idx ? { ...s, ...partial } : s));
    onChange({ ...value, sequence });
  }

  const steps = value.sequence
    .map((step, idx) => ({ step, idx }))
    .sort((a, b) => a.step.order - b.step.order);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Grupo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Etiqueta del grupo</Label>
            <Input
              value={value.groupLabel}
              placeholder="Etiqueta del grupo"
              disabled={disabled}
              onChange={(e) => onChange({ ...value, groupLabel: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Brecha compartida</Label>
            <textarea
              className={textareaClass}
              value={value.sharedGap}
              placeholder="Brecha compartida del grupo"
              disabled={disabled}
              onChange={(e) => onChange({ ...value, sharedGap: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Sesiones estimadas</Label>
            <Input
              type="number"
              min={0}
              className="w-40"
              value={value.estimatedSessions ?? ''}
              placeholder="Sesiones"
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...value,
                  estimatedSessions: e.target.value === '' ? null : Number(e.target.value),
                })
              }
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Alumnos en el grupo: <span className="font-medium">{value.studentCount}</span>{' '}
            (calculado automáticamente)
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Secuencia remedial</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {steps.map(({ step, idx }) => (
            <div key={step.order} className="space-y-2 rounded-md border bg-muted/20 p-3">
              <span className="inline-block rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                Paso {step.order}
              </span>
              <Input
                value={step.title}
                placeholder="Título del paso"
                disabled={disabled}
                onChange={(e) => patchStep(idx, { title: e.target.value })}
              />
              <textarea
                className={textareaClass}
                value={step.description}
                placeholder="Descripción del paso"
                disabled={disabled}
                onChange={(e) => patchStep(idx, { description: e.target.value })}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
