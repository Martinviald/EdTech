'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { Loader2, Sparkles } from 'lucide-react';
import type { RemedialMaterialType } from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCallout } from '@/components/patterns';
import { generateRemedial } from '../actions';
import { AI_DISCLAIMER, REMEDIAL_TYPE_LABELS, REMEDIAL_TYPE_OPTIONS } from './labels';

interface GeneratePanelProps {
  nodeId: string;
  nodeName?: string;
  assessmentId?: string;
  classGroupId?: string;
  sourceAnalysisId?: string;
  /** Tipo preseleccionado desde el enlace de la brecha; si falta, se muestra selector. */
  presetType?: RemedialMaterialType;
}

/**
 * Panel para disparar la generación de material remedial desde una brecha
 * (`nodeId`). Permite elegir el tipo (si no viene preseleccionado) y, para el
 * plan por grupo, requiere `classGroupId`. Tras crear el registro redirige al
 * detalle (`/material-remedial/:id`), donde se hace el polling del estado.
 */
export function GeneratePanel({
  nodeId,
  nodeName,
  assessmentId,
  classGroupId,
  sourceAnalysisId,
  presetType,
}: GeneratePanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [type, setType] = useState<RemedialMaterialType>(presetType ?? 'guide');
  const [itemCount, setItemCount] = useState<number | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const needsClassGroup = type === 'group_plan' && !classGroupId;

  function handleGenerate() {
    setError(null);
    if (needsClassGroup) {
      setError(
        'El plan por grupo requiere un curso de origen. Genera este material desde la brecha de un curso específico.',
      );
      return;
    }
    startTransition(async () => {
      try {
        // itemCount solo aplica a practice_set; fuera de rango se acota a [1, 20]. Si el
        // usuario no fija un valor, se omite y el backend usa su default.
        const count =
          type === 'practice_set' && itemCount !== undefined
            ? Math.min(20, Math.max(1, Math.round(itemCount)))
            : undefined;
        const { materialId } = await generateRemedial({
          type,
          nodeId,
          assessmentId,
          classGroupId,
          sourceAnalysisId,
          itemCount: count,
        });
        router.replace(`/material-remedial/${materialId}` as Route);
        router.refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'No se pudo generar el material remedial.',
        );
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Sparkles className="size-5 text-primary" aria-hidden />
          Generar material remedial
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {nodeName ? (
            <>
              Brecha a remediar: <span className="font-medium text-foreground">{nodeName}</span>.{' '}
            </>
          ) : null}
          Elige el tipo de material a generar. El proceso es asíncrono y puede tomar algunos
          segundos.
        </p>

        <div className="flex flex-col gap-2 sm:max-w-xs">
          <label className="text-sm font-medium text-foreground" htmlFor="remedial-type">
            Tipo de material
          </label>
          <Select
            value={type}
            onValueChange={(v) => setType(v as RemedialMaterialType)}
            disabled={isPending}
          >
            <SelectTrigger id="remedial-type" className="w-full">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              {REMEDIAL_TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {presetType ? (
            <p className="text-xs text-muted-foreground">
              Sugerido desde la brecha: {REMEDIAL_TYPE_LABELS[presetType]}. Puedes cambiarlo.
            </p>
          ) : null}
        </div>

        {type === 'practice_set' ? (
          <div className="flex flex-col gap-2 sm:max-w-xs">
            <label className="text-sm font-medium text-foreground" htmlFor="remedial-item-count">
              Número de ejercicios
            </label>
            <Input
              id="remedial-item-count"
              type="number"
              min={1}
              max={20}
              inputMode="numeric"
              placeholder="Por defecto del sistema"
              value={itemCount ?? ''}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') {
                  setItemCount(undefined);
                  return;
                }
                const parsed = Number(raw);
                setItemCount(Number.isFinite(parsed) ? parsed : undefined);
              }}
              disabled={isPending}
            />
            <p className="text-xs text-muted-foreground">
              Entre 1 y 20. Si lo dejas vacío, se usa el valor por defecto del sistema.
            </p>
          </div>
        ) : null}

        <AlertCallout tone="info" title="La IA propone, tú apruebas">
          {AI_DISCLAIMER}
        </AlertCallout>

        {error ? <AlertCallout tone="danger">{error}</AlertCallout> : null}

        <Button onClick={handleGenerate} disabled={isPending}>
          {isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="size-4" aria-hidden />
          )}
          Generar material
        </Button>
      </CardContent>
    </Card>
  );
}
