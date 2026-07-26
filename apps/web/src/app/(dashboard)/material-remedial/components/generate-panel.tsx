'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, Loader2, Sparkles } from 'lucide-react';
import type { RemedialMaterialType, RemedialMethod } from '@soe/types';
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
import { AlertCallout } from '@/components/shared';
import { cn } from '@/lib/utils';
import { ROUTES } from '@/lib/routes';
import {
  generateRemedial,
  getCandidateStimuli,
  type CandidateStimuliResponse,
} from '../actions';
import {
  AI_DISCLAIMER,
  REMEDIAL_METHOD_OPTIONS,
  REMEDIAL_NO_STIMULUS_NOTICE,
  REMEDIAL_TYPE_LABELS,
  REMEDIAL_TYPE_OPTIONS,
} from './labels';

interface GeneratePanelProps {
  nodeId: string;
  nodeName?: string;
  assessmentId?: string;
  classGroupId?: string;
  sourceAnalysisId?: string;
  /** Tipo preseleccionado desde el enlace de la brecha; si falta, se muestra selector. */
  presetType?: RemedialMaterialType;
}

/** Opción normalizada del picker de pasaje (fallado de la evaluación o del banco). */
interface PassageOption {
  sectionId: string;
  title: string | null;
  preview: string | null;
  gap: number | null; // solo `fromAssessment`; `null` para el banco
  origin: 'assessment' | 'bank';
}

/** Recorta el texto a una vista previa legible de una línea. */
function previewText(text: string | null, max = 180): string {
  if (!text) return '';
  const clean = text.trim().replace(/\s+/g, ' ');
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean;
}

/**
 * Panel para disparar la generación de material remedial desde una brecha
 * (`nodeId`). Permite elegir el tipo (si no viene preseleccionado) y, para el
 * plan por grupo, requiere `classGroupId`. Tras crear el registro redirige al
 * detalle (`/material-remedial/:id`), donde se hace el polling del estado.
 *
 * Ola 2.1a (practice_set): selector de método. «Mismas lecturas» (Opción A)
 * genera preguntas nuevas sobre un texto OFICIAL — el docente elige el pasaje de
 * una lista (default = mayor brecha) vía `getCandidateStimuli`; «Ejercicios sin
 * texto» genera MCQ sin pasaje; «Texto nuevo IA» (Opción B) llega en 2.2.
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
  const [method, setMethod] = useState<RemedialMethod>('self_contained');
  const [candidates, setCandidates] = useState<CandidateStimuliResponse | null>(null);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [stimulusId, setStimulusId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const needsClassGroup = type === 'group_plan' && !classGroupId;

  // El picker/método solo aplica a practice_set con evaluación de origen. Al entrar
  // en ese modo cargamos los pasajes candidatos: definen el DEFAULT (reuse si hay,
  // self_contained si no) y precargan el picker de la Opción A.
  useEffect(() => {
    if (type !== 'practice_set' || !assessmentId) {
      setCandidates(null);
      setStimulusId(undefined);
      setLoadingCandidates(false);
      setCandidatesError(null);
      setMethod('self_contained');
      return;
    }

    let cancelled = false;
    setLoadingCandidates(true);
    setCandidatesError(null);
    getCandidateStimuli(assessmentId, nodeId)
      .then((res) => {
        if (cancelled) return;
        setCandidates(res);
        const hasCandidates =
          res.fromAssessment.length > 0 || res.fromBank.length > 0;
        setMethod(hasCandidates ? 'reuse_stimulus' : 'self_contained');
        // Default = mayor brecha (fromAssessment ya viene ordenado desc); si no hay
        // fallados, la primera alternativa del banco.
        setStimulusId(res.fromAssessment[0]?.sectionId ?? res.fromBank[0]?.sectionId);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCandidates({ fromAssessment: [], fromBank: [] });
        setStimulusId(undefined);
        setMethod('self_contained');
        setCandidatesError(
          err instanceof Error ? err.message : 'No se pudieron cargar las lecturas.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingCandidates(false);
      });

    return () => {
      cancelled = true;
    };
  }, [type, assessmentId, nodeId]);

  const hasCandidates = Boolean(
    candidates &&
      (candidates.fromAssessment.length > 0 || candidates.fromBank.length > 0),
  );
  // Reuse requiere una evaluación de origen y al menos un pasaje candidato.
  const canReuse = Boolean(assessmentId) && hasCandidates;
  // Fallback: modo A pedido pero la habilidad no tiene textos (evaluación ni banco).
  const showFallbackNotice =
    type === 'practice_set' &&
    Boolean(assessmentId) &&
    candidates !== null &&
    !hasCandidates &&
    !loadingCandidates;
  const showPicker = type === 'practice_set' && method === 'reuse_stimulus' && canReuse;

  const passageOptions: PassageOption[] = candidates
    ? [
        ...candidates.fromAssessment.map((s) => ({
          sectionId: s.sectionId,
          title: s.title,
          preview: s.text,
          gap: s.gap,
          origin: 'assessment' as const,
        })),
        ...candidates.fromBank.map((s) => ({
          sectionId: s.sectionId,
          title: s.title,
          preview: s.textPreview,
          gap: null,
          origin: 'bank' as const,
        })),
      ]
    : [];
  const assessmentOptions = passageOptions.filter((o) => o.origin === 'assessment');
  const bankOptions = passageOptions.filter((o) => o.origin === 'bank');

  function methodDisabled(value: RemedialMethod, optDisabled?: boolean): boolean {
    if (optDisabled) return true; // generate_stimulus (Opción B, próximamente)
    if (value === 'reuse_stimulus') return !canReuse || loadingCandidates;
    return false; // self_contained siempre disponible
  }

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
        // Método efectivo: reuse solo si es válido (evaluación + candidatos); de lo
        // contrario self_contained. El stimulusId (override del pasaje) solo va con reuse.
        const effectiveMethod: RemedialMethod =
          type === 'practice_set' && method === 'reuse_stimulus' && canReuse
            ? 'reuse_stimulus'
            : 'self_contained';
        const { materialId } = await generateRemedial({
          type,
          nodeId,
          assessmentId,
          classGroupId,
          sourceAnalysisId,
          itemCount: count,
          method: type === 'practice_set' ? effectiveMethod : undefined,
          stimulusId:
            effectiveMethod === 'reuse_stimulus' ? stimulusId : undefined,
        });
        router.replace(ROUTES.materialRemedialDetalle(materialId));
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudo generar el material remedial.');
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
              Brecha a remediar: <span className="font-medium text-foreground">{nodeName}</span>
              .{' '}
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
          <>
            <fieldset className="space-y-2" disabled={isPending}>
              <legend className="text-sm font-medium text-foreground">
                Cómo generar las preguntas
              </legend>
              {REMEDIAL_METHOD_OPTIONS.map((opt) => {
                const disabled = methodDisabled(opt.value, opt.disabled);
                const checked = method === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition',
                      checked
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/40',
                      disabled && 'cursor-not-allowed opacity-60 hover:border-border',
                    )}
                  >
                    <input
                      type="radio"
                      name="remedial-method"
                      value={opt.value}
                      checked={checked}
                      disabled={disabled}
                      onChange={() => setMethod(opt.value)}
                      className="mt-1 size-4 shrink-0 accent-primary"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{opt.label}</span>
                        {opt.badge ? (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                            {opt.badge}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {opt.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            {loadingCandidates ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Buscando lecturas disponibles…
              </p>
            ) : null}

            {candidatesError ? (
              <AlertCallout tone="danger">{candidatesError}</AlertCallout>
            ) : null}

            {showFallbackNotice ? (
              <AlertCallout tone="warning" title="Sin textos para esta habilidad">
                {REMEDIAL_NO_STIMULUS_NOTICE}
              </AlertCallout>
            ) : null}

            {showPicker ? (
              <fieldset className="space-y-3" disabled={isPending}>
                <legend className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <BookOpen className="size-4 text-muted-foreground" aria-hidden />
                  Elige la lectura
                </legend>

                {assessmentOptions.length > 0 ? (
                  <div className="space-y-2">
                    {assessmentOptions.map((option) => (
                      <PassageRadio
                        key={`assessment-${option.sectionId}`}
                        option={option}
                        checked={stimulusId === option.sectionId}
                        onSelect={() => setStimulusId(option.sectionId)}
                      />
                    ))}
                  </div>
                ) : null}

                {bankOptions.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Otras lecturas del banco
                    </p>
                    {bankOptions.map((option) => (
                      <PassageRadio
                        key={`bank-${option.sectionId}`}
                        option={option}
                        checked={stimulusId === option.sectionId}
                        onSelect={() => setStimulusId(option.sectionId)}
                      />
                    ))}
                  </div>
                ) : null}
              </fieldset>
            ) : null}

            <div className="flex flex-col gap-2 sm:max-w-xs">
              <label
                className="text-sm font-medium text-foreground"
                htmlFor="remedial-item-count"
              >
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
          </>
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

/** Opción de pasaje del picker (radio accesible con título + preview + brecha). */
function PassageRadio({
  option,
  checked,
  onSelect,
}: {
  option: PassageOption;
  checked: boolean;
  onSelect: () => void;
}) {
  const preview = previewText(option.preview);
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition',
        checked ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40',
      )}
    >
      <input
        type="radio"
        name="remedial-stimulus"
        value={option.sectionId}
        checked={checked}
        onChange={onSelect}
        className="mt-1 size-4 shrink-0 accent-primary"
      />
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {option.title?.trim() || 'Texto de lectura'}
          </span>
          {option.gap !== null ? (
            <span className="rounded bg-warning/15 px-1.5 py-0.5 text-xs font-medium text-warning">
              {Math.round(option.gap)}% de brecha
            </span>
          ) : null}
        </span>
        {preview ? (
          <span className="block text-xs leading-relaxed text-muted-foreground">{preview}</span>
        ) : (
          <span className="block text-xs italic text-muted-foreground">
            Sin vista previa de texto.
          </span>
        )}
      </span>
    </label>
  );
}
