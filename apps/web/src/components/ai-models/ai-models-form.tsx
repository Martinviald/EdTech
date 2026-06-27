'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type {
  LlmFeatureConfig,
  LlmProviderId,
  LlmSettingsResponse,
} from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { updateLlmModelAction } from './actions';

interface AiModelsFormProps {
  initial: LlmSettingsResponse;
}

/** Fila editable: valores actuales + los últimos persistidos (para detectar cambios). */
interface EditableRow {
  feature: LlmFeatureConfig['feature'];
  label: string;
  description: string;
  source: LlmFeatureConfig['source'];
  provider: LlmProviderId;
  model: string;
  savedProvider: LlmProviderId;
  savedModel: string;
}

function toRow(f: LlmFeatureConfig): EditableRow {
  return {
    feature: f.feature,
    label: f.label,
    description: f.description,
    source: f.source,
    provider: f.provider,
    model: f.model,
    savedProvider: f.provider,
    savedModel: f.model,
  };
}

export function AiModelsForm({ initial }: AiModelsFormProps) {
  const [rows, setRows] = useState<EditableRow[]>(() => initial.features.map(toRow));
  const [savingFeature, setSavingFeature] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const modelsFor = (provider: LlmProviderId) => initial.catalog[provider] ?? [];

  function patchRow(feature: string, patch: Partial<EditableRow>) {
    setRows((rs) => rs.map((r) => (r.feature === feature ? { ...r, ...patch } : r)));
  }

  function onProviderChange(feature: string, provider: LlmProviderId) {
    const first = modelsFor(provider)[0]?.id ?? '';
    patchRow(feature, { provider, model: first });
  }

  function save(row: EditableRow) {
    setSavingFeature(row.feature);
    startTransition(async () => {
      try {
        const res = await updateLlmModelAction(row.feature, {
          provider: row.provider,
          model: row.model,
        });
        setRows(res.features.map(toRow));
        toast.success('Modelo actualizado');
      } catch {
        toast.error('No se pudo guardar el modelo');
      } finally {
        setSavingFeature(null);
      }
    });
  }

  return (
    <div className="space-y-4">
      {rows.map((row) => {
        const isDirty = row.provider !== row.savedProvider || row.model !== row.savedModel;
        const saving = savingFeature === row.feature;
        return (
          <Card key={row.feature}>
            <CardContent className="space-y-4 p-5">
              <div>
                <h2 className="font-medium">{row.label}</h2>
                <p className="text-muted-foreground mt-1 text-sm">{row.description}</p>
                {row.source === 'default' ? (
                  <p className="text-muted-foreground mt-1 text-xs italic">
                    Usando el valor por defecto (sin configuración guardada).
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor={`provider-${row.feature}`}>Proveedor</Label>
                  <Select
                    value={row.provider}
                    onValueChange={(v) => onProviderChange(row.feature, v as LlmProviderId)}
                    disabled={saving}
                  >
                    <SelectTrigger id={`provider-${row.feature}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {initial.providers.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex-1 space-y-1.5">
                  <Label htmlFor={`model-${row.feature}`}>Modelo</Label>
                  <Select
                    value={row.model}
                    onValueChange={(v) => patchRow(row.feature, { model: v })}
                    disabled={saving}
                  >
                    <SelectTrigger id={`model-${row.feature}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {modelsFor(row.provider).map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button onClick={() => save(row)} disabled={!isDirty || saving}>
                  {saving ? 'Guardando…' : 'Guardar'}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
