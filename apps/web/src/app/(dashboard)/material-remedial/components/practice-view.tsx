import { AlertTriangle, BookOpen, CheckCircle2, Info } from 'lucide-react';
import type {
  JudgeVerdict,
  QualityReport,
  RemedialPracticeContent,
  RemedialPracticeItemPreview,
  RemedialStimulus,
} from '@soe/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCallout } from '@/components/patterns';
import { cn } from '@/lib/utils';
import { REMEDIAL_JUDGE_LABELS } from './labels';

const POSITION_BADGE =
  'mt-0.5 shrink-0 rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary';

/**
 * Pasaje (estímulo) del set, solo-lectura, arriba de las preguntas (Ola 2.1a · Opción A).
 * Estilo legible tipo lectura; preserva saltos y espacios con `whitespace-pre-wrap`.
 */
function StimulusPassage({ stimulus }: { stimulus: RemedialStimulus }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          {stimulus.title?.trim() || 'Texto de lectura'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {stimulus.text}
        </p>
      </CardContent>
    </Card>
  );
}

/** Motivos de falla dura (hard-gate) derivados del veredicto del juez, en español. */
function hardFailReasons(verdict: JudgeVerdict): string[] {
  const reasons: string[] = [];
  if (!verdict.answerable) reasons.push(REMEDIAL_JUDGE_LABELS.notAnswerable);
  if (!verdict.uniqueCorrect) reasons.push(REMEDIAL_JUDGE_LABELS.notUniqueCorrect);
  if (!verdict.factual) reasons.push(REMEDIAL_JUDGE_LABELS.notFactual);
  return reasons;
}

/**
 * Flag del juez automático por ítem (Ola 2.1b). Falla dura (answerable / uniqueCorrect /
 * factual) ⇒ aviso de advertencia con los motivos y las objeciones; `skillMatch=false` sin
 * falla dura ⇒ aviso blando informativo; todo ok ⇒ check verde discreto. Sin veredicto para
 * la posición (material antiguo o degradación) ⇒ no renderiza nada.
 */
function ItemVerdictFlag({ verdict }: { verdict?: JudgeVerdict }) {
  if (!verdict) return null;

  const reasons = hardFailReasons(verdict);
  const objections = verdict.objections.filter((objection) => objection.trim());

  if (reasons.length > 0) {
    return (
      <div className="rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs">
        <p className="flex items-center gap-1.5 font-medium text-warning">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          {REMEDIAL_JUDGE_LABELS.itemReviewNeeded}
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-foreground">
          {reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        {objections.length > 0 ? (
          <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
            {objections.map((objection, idx) => (
              <li key={idx}>{objection}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  if (!verdict.skillMatch) {
    return (
      <div className="rounded-md border border-info/30 bg-info/5 p-2.5 text-xs">
        <p className="flex items-center gap-1.5 font-medium text-info">
          <Info className="size-3.5 shrink-0" aria-hidden />
          {REMEDIAL_JUDGE_LABELS.skillMismatch}
        </p>
        {objections.length > 0 ? (
          <ul className="mt-1 space-y-0.5 text-muted-foreground">
            {objections.map((objection, idx) => (
              <li key={idx}>{objection}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <p className="inline-flex items-center gap-1 text-xs font-medium text-success">
      <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
      {REMEDIAL_JUDGE_LABELS.validated}
    </p>
  );
}

/** Ítem completo (enunciado + alternativas + explicación) hidratado desde `items` (G2). */
function PracticeItemCard({
  item,
  verdict,
}: {
  item: RemedialPracticeItemPreview;
  /** Veredicto del juez para esta posición (Ola 2.1b); ausente ⇒ sin flag. */
  verdict?: JudgeVerdict;
}) {
  const alternatives = item.alternatives ?? [];
  return (
    <li className="rounded-md border bg-muted/30 p-3 sm:p-4">
      <div className="flex items-start gap-2">
        <span className={POSITION_BADGE}>{item.position}</span>
        <div className="min-w-0 flex-1 space-y-3">
          <ItemVerdictFlag verdict={verdict} />

          {item.stem ? (
            <p className="text-sm text-foreground">{item.stem}</p>
          ) : (
            <p className="text-sm italic text-muted-foreground">Ítem sin enunciado.</p>
          )}

          {alternatives.length > 0 ? (
            <ul className="space-y-1.5">
              {alternatives.map((alt) => {
                const isCorrect =
                  alt.isCorrect || (item.correctKey != null && alt.key === item.correctKey);
                return (
                  <li
                    key={alt.key}
                    className={cn(
                      'flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-sm',
                      isCorrect
                        ? 'border-success/40 bg-success/10 text-foreground'
                        : 'border-border bg-background text-muted-foreground',
                    )}
                  >
                    <span className="font-medium text-foreground">{alt.key})</span>
                    <span className="min-w-0 flex-1">{alt.text}</span>
                    {isCorrect ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-success">
                        <CheckCircle2 className="size-3.5" aria-hidden />
                        Correcta
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}

          {item.explanation ? (
            <div className="rounded-md bg-muted/50 p-2.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Explicación
              </p>
              <p className="mt-1 text-sm text-foreground">{item.explanation}</p>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/**
 * Render de solo lectura de un set de ítems de práctica (H9.3 · Ola 1 remedial G2).
 *
 * Si el detalle trae `practiceItems` (preview hidratado on-read desde `items`),
 * muestra el ítem COMPLETO: enunciado + alternativas (marcando la correcta) +
 * explicación. Si no llega (material antiguo o nodo sin generación), degrada al
 * listado ligero por `stem` de las refs del `content`, sin romper.
 *
 * Si el detalle trae `qualityReport` (Ola 2.1b), muestra el estado del juez
 * automático: banner si no convergió (`exhausted`), check discreto si convergió, y
 * los flags por ítem mapeando los veredictos por `position`.
 */
export function PracticeView({
  content,
  practiceItems,
  stimuli,
  qualityReport,
}: {
  content: RemedialPracticeContent;
  /** Preview hidratado del detalle; ausente/vacío ⇒ degradación al `stem` de las refs. */
  practiceItems?: RemedialPracticeItemPreview[] | null;
  /**
   * Estímulos hidratados (texto completo del pasaje) del set (Ola 2.1a · Opción A).
   * Ausente/vacío (o sin texto) ⇒ vista actual sin pasaje, sin romper.
   */
  stimuli?: RemedialStimulus[] | null;
  /**
   * Reporte del juez automático (Ola 2.1b). `exhausted` ⇒ banner de no-convergencia;
   * `converged` ⇒ check discreto. Los veredictos se mapean por `position` a cada ítem.
   * Ausente/`null` (material antiguo, guía o plan) ⇒ sin flags, sin romper.
   */
  qualityReport?: QualityReport | null;
}) {
  const hasPreview = Array.isArray(practiceItems) && practiceItems.length > 0;
  const previewItems = hasPreview
    ? [...practiceItems].sort((a, b) => a.position - b.position)
    : [];
  const refItems = [...content.items].sort((a, b) => a.position - b.position);
  const passages = (stimuli ?? []).filter((s) => s.text && s.text.trim());

  const verdictByPosition = new Map<number, JudgeVerdict>(
    (qualityReport?.verdicts ?? []).map((verdict): [number, JudgeVerdict] => [
      verdict.position,
      verdict,
    ]),
  );

  return (
    <div className="space-y-4">
      {qualityReport?.finalStatus === 'exhausted' ? (
        <AlertCallout tone="warning" title={REMEDIAL_JUDGE_LABELS.notConvergedTitle}>
          {REMEDIAL_JUDGE_LABELS.notConverged(qualityReport.iterations)}
        </AlertCallout>
      ) : qualityReport?.finalStatus === 'converged' ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-success">
          <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
          {REMEDIAL_JUDGE_LABELS.converged}
        </p>
      ) : null}

      {passages.map((stimulus) => (
        <StimulusPassage key={stimulus.sectionId} stimulus={stimulus} />
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Habilidad focalizada</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-foreground">
          <p>{content.skillFocus}</p>
          <p className="text-muted-foreground">{content.itemCount} ítems generados</p>
          {content.notes ? <p className="text-muted-foreground">{content.notes}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ítems de práctica (borrador)</CardTitle>
        </CardHeader>
        <CardContent>
          {hasPreview ? (
            <ol className="space-y-4">
              {previewItems.map((item) => (
                <PracticeItemCard
                  key={item.itemId}
                  item={item}
                  verdict={verdictByPosition.get(item.position)}
                />
              ))}
            </ol>
          ) : refItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay ítems en este set.</p>
          ) : (
            <ol className="space-y-3">
              {refItems.map((item) => (
                <li key={item.itemId} className="rounded-md border bg-muted/30 p-3">
                  <div className="flex items-start gap-2">
                    <span className={POSITION_BADGE}>{item.position}</span>
                    <p className="text-sm text-foreground">{item.stem}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Los ítems se publican en el banco al aprobar este material.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
