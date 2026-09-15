'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AUTO_ANNUL_RECOMMENDED_MIN_CONFIDENCE,
  updateOrgReviewSettingsSchema,
  type OrgReviewSettingsResponse,
} from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { AlertCallout, Field } from '@/components/shared';
import { saveReviewSettings } from './actions';

type ReviewSettingsFormProps = {
  initial: OrgReviewSettingsResponse;
};

export function ReviewSettingsForm({ initial }: ReviewSettingsFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [quickConfirm, setQuickConfirm] = useState(initial.review.quickConfirm === true);
  const [autoAnnulEnabled, setAutoAnnulEnabled] = useState(
    initial.review.autoAnnulMinConfidence !== undefined,
  );
  const [threshold, setThreshold] = useState(
    String(initial.review.autoAnnulMinConfidence ?? AUTO_ANNUL_RECOMMENDED_MIN_CONFIDENCE),
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const thresholdNumber = Number(threshold);
    if (autoAnnulEnabled && (threshold.trim() === '' || Number.isNaN(thresholdNumber))) {
      toast.error('Ingresa una confianza mínima entre 0 y 1.');
      return;
    }
    const parsed = updateOrgReviewSettingsSchema.safeParse({
      quickConfirm,
      autoAnnulMinConfidence: autoAnnulEnabled ? thresholdNumber : null,
    });
    if (!parsed.success) {
      toast.error('La confianza mínima debe estar entre 0 y 1.');
      return;
    }

    startTransition(async () => {
      const result = await saveReviewSettings(parsed.data);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success('Ajustes de revisión guardados.');
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Marcas dudosas</CardTitle>
          <CardDescription>
            Cómo confirma el revisor una marca en la que el lector no está seguro.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingRow
            id="review-quick-confirm"
            label="Confirmar con Sí/No"
            description="Cuando el lector sugiere una alternativa, el revisor la confirma o la rechaza en un paso, sin elegir entre todas las opciones. Si la rechaza, elige la alternativa correcta como siempre."
            checked={quickConfirm}
            onCheckedChange={setQuickConfirm}
            disabled={isPending}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dobles marcas</CardTitle>
          <CardDescription>
            Qué hacer con las preguntas en las que el alumno marcó más de una alternativa.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SettingRow
            id="review-auto-annul"
            label="Anular dobles marcas evidentes"
            description="Una doble marca que el lector detecta con confianza igual o superior al umbral se anula sola al leer la hoja y no entra a la cola de revisión."
            checked={autoAnnulEnabled}
            onCheckedChange={setAutoAnnulEnabled}
            disabled={isPending}
          />

          {autoAnnulEnabled ? (
            <Field
              label="Confianza mínima para anular"
              htmlFor="review-auto-annul-threshold"
              hint={`Entre 0 y 1. Recomendado: ${AUTO_ANNUL_RECOMMENDED_MIN_CONFIDENCE}. Con ese valor se anulan solas las dobles con ambas burbujas rellenas; las dudosas siguen en revisión.`}
            >
              <Input
                id="review-auto-annul-threshold"
                type="number"
                inputMode="decimal"
                min={0}
                max={1}
                step={0.01}
                value={threshold}
                disabled={isPending}
                onChange={(e) => setThreshold(e.target.value)}
                className="w-32"
              />
            </Field>
          ) : null}

          <AlertCallout tone="info">
            Las nulas automáticas quedan visibles en el lote y se pueden corregir a mano en
            cualquier momento; nunca se pierde la lectura original.
          </AlertCallout>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  );
}

function SettingRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p id={`${id}-description`} className="text-xs text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch
        id={id}
        aria-describedby={`${id}-description`}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  );
}
