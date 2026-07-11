'use client';

import type { RemedialGuideContent } from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const textareaClass =
  'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

interface GuideEditorProps {
  value: RemedialGuideContent;
  onChange: (next: RemedialGuideContent) => void;
  disabled?: boolean;
}

/**
 * Editor de la guía de reenseñanza (H9.5): permite ajustar el contenido sugerido
 * por la IA antes de aprobarlo. El humano propone el override; el padre envía el
 * `content` editado en la acción `approve`.
 */
export function GuideEditor({ value, onChange, disabled }: GuideEditorProps) {
  function patch(partial: Partial<RemedialGuideContent>) {
    onChange({ ...value, ...partial });
  }

  function patchActivity(
    idx: number,
    partial: Partial<RemedialGuideContent['classActivities'][number]>,
  ) {
    const classActivities = value.classActivities.map((a, i) =>
      i === idx ? { ...a, ...partial } : a,
    );
    onChange({ ...value, classActivities });
  }

  function updateList(list: string[], idx: number, next: string): string[] {
    return list.map((v, i) => (i === idx ? next : v));
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Objetivo</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            className={textareaClass}
            value={value.objective}
            disabled={disabled}
            onChange={(e) => patch({ objective: e.target.value })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Causa de la brecha</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            className={textareaClass}
            value={value.rootCauseSummary}
            disabled={disabled}
            onChange={(e) => patch({ rootCauseSummary: e.target.value })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Estrategia de reenseñanza</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            className={textareaClass}
            value={value.strategy}
            disabled={disabled}
            onChange={(e) => patch({ strategy: e.target.value })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actividades de clase</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {value.classActivities.map((activity, idx) => (
            <div key={idx} className="space-y-2 rounded-md border bg-muted/20 p-3">
              <Input
                value={activity.title}
                placeholder="Título de la actividad"
                disabled={disabled}
                onChange={(e) => patchActivity(idx, { title: e.target.value })}
              />
              <textarea
                className={textareaClass}
                value={activity.description}
                placeholder="Descripción"
                disabled={disabled}
                onChange={(e) => patchActivity(idx, { description: e.target.value })}
              />
              <Input
                type="number"
                min={0}
                value={activity.durationMin ?? ''}
                placeholder="Duración (min)"
                className="w-40"
                disabled={disabled}
                onChange={(e) =>
                  patchActivity(idx, {
                    durationMin: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {value.materials.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Materiales sugeridos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {value.materials.map((m, idx) => (
              <Input
                key={idx}
                value={m}
                disabled={disabled}
                onChange={(e) =>
                  patch({ materials: updateList(value.materials, idx, e.target.value) })
                }
              />
            ))}
          </CardContent>
        </Card>
      ) : null}

      {value.successCriteria.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Criterios de logro</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {value.successCriteria.map((c, idx) => (
              <Input
                key={idx}
                value={c}
                disabled={disabled}
                onChange={(e) =>
                  patch({
                    successCriteria: updateList(value.successCriteria, idx, e.target.value),
                  })
                }
              />
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
