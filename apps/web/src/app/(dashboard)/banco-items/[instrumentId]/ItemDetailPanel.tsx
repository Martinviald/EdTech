'use client';

import type { JSX } from 'react';
import { CheckCircle2, FileQuestion } from 'lucide-react';
import type { ItemModel, ItemTaxonomyTagModel, InstrumentSectionModel } from '@soe/types';
import { Badge } from '@/components/ui/badge';
import {
  hasPassageContent,
  toPassageAttachments,
  type PassageData,
} from '@/components/passage-dialog';
import { cn } from '@/lib/utils';
import { QuestionDetailSheet } from '@/components/question-detail/question-detail-sheet';
import { QuestionNodes, type QuestionNodeTag } from '@/components/question-detail/question-nodes';
import { ItemEditProposals } from './ItemEditProposals';

function sectionToPassage(section: InstrumentSectionModel): PassageData {
  return {
    sectionName: section.name,
    passageTitle: section.passageTitle,
    passageText: section.passageText,
    passageFormat: section.passageFormat,
    attachments: toPassageAttachments(section.id, section.attachments ?? []),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel de detalle de un ítem del banco. Muestra el enunciado completo, las
// alternativas (si las hay, marcando la correcta) y todos los nodos de taxonomía
// asociados (habilidades, OAs, ejes, etc.), agrupados por tipo de nodo.
//
// El panel es controlado por el padre (la tabla de ítems) y recibe el ítem ya
// cargado por `data` — no hace fetch propio, porque `GET /items?instrumentId=…`
// ya retorna el `content` y los `tags` con su nodo poblado.
// ─────────────────────────────────────────────────────────────────────────────

const ITEM_TYPE_LABELS: Record<string, string> = {
  multiple_choice: 'Selección múltiple',
  true_false: 'Verdadero/Falso',
  open_ended: 'Desarrollo',
  oral_reading: 'Lectura oral',
  oral_expression: 'Expresión oral',
  writing: 'Escritura',
  listening: 'Comprensión auditiva',
  matching: 'Términos pareados',
  ordering: 'Ordenamiento',
  gap_fill: 'Completar',
};

type Alternative = { key: string; text?: string; isCorrect?: boolean };

/** Extrae el enunciado del ítem desde el `content` JSONB (varios alias posibles). */
function getStem(content: Record<string, unknown>): string | null {
  for (const field of ['stem', 'text', 'prompt', 'question'] as const) {
    if (typeof content[field] === 'string' && content[field]) {
      return content[field] as string;
    }
  }
  return null;
}

/** Lee las alternativas tipadas del `content`, si el ítem es de selección. */
function getAlternatives(content: Record<string, unknown>): Alternative[] {
  const raw = content.alternatives;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (alt): alt is Alternative => typeof alt === 'object' && alt !== null && 'key' in alt,
  );
}

function getStringField(content: Record<string, unknown>, field: string): string | null {
  return typeof content[field] === 'string' && content[field] ? (content[field] as string) : null;
}

/** Keys de las alternativas que SON imágenes (scoring_config.altImageRefs). */
function altImageKeys(item: ItemModel): Set<string> {
  const refs = (item.scoringConfig?.altImageRefs ?? null) as Record<string, unknown> | null;
  if (!refs) return new Set();
  return new Set(Object.keys(refs).filter((k) => typeof refs[k] === 'string'));
}

export function ItemDetailPanel(props: {
  item: ItemModel | null;
  sections?: InstrumentSectionModel[];
  canEdit?: boolean;
  instrumentId?: string;
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const { item, sections = [], canEdit = false, instrumentId, open, onClose } = props;

  const section = item?.sectionId ? (sections.find((s) => s.id === item.sectionId) ?? null) : null;
  const passage = section && hasPassageContent(section) ? sectionToPassage(section) : null;

  // `GET /items?instrumentId=…` ya trae `scoringConfig` completo, así que el flag
  // de figura se deriva del ítem que ya tenemos —sin un fetch extra—.
  const figureItemId = item && typeof item.scoringConfig?.imageRef === 'string' ? item.id : null;

  return (
    <QuestionDetailSheet
      open={open}
      onClose={onClose}
      position={item?.position ?? null}
      headerBadges={
        item ? <Badge variant="outline">{ITEM_TYPE_LABELS[item.type] ?? item.type}</Badge> : null
      }
      description="Enunciado completo, alternativas y nodos de taxonomía asociados a la pregunta."
      passage={passage}
      figureItemId={figureItemId}
      storageKey="soe.itemDetail.panelWidth"
    >
      {item ? (
        <ItemDetailContent
          item={item}
          canEdit={canEdit}
          instrumentId={instrumentId ?? item.instrumentId ?? ''}
        />
      ) : null}
    </QuestionDetailSheet>
  );
}

/** Normaliza los tags del ítem a la forma común de `QuestionNodes`. */
function toNodeTags(tags: ItemTaxonomyTagModel[]): QuestionNodeTag[] {
  return tags.map((t) => ({
    nodeId: t.nodeId,
    code: t.node?.code ?? null,
    type: t.node?.type ?? 'unknown',
    name: t.node?.name ?? '',
    taggedBy: t.taggedBy,
  }));
}

function ItemDetailContent({
  item,
  canEdit,
  instrumentId,
}: {
  item: ItemModel;
  canEdit: boolean;
  instrumentId: string;
}): JSX.Element {
  const content = item.content ?? {};
  const stem = getStem(content);
  const alternatives = getAlternatives(content);
  const imageUrl = getStringField(content, 'imageUrl');
  const explanation = getStringField(content, 'explanation');
  const imageKeys = altImageKeys(item);

  return (
    <div className="mt-6 space-y-6">
      {/* Enunciado */}
      <section className="space-y-1.5">
        <h3 className="text-sm font-semibold text-foreground">Enunciado</h3>
        <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
          {stem ?? 'Esta pregunta no tiene enunciado registrado.'}
        </p>
        {explanation ? <p className="text-xs text-muted-foreground">{explanation}</p> : null}
      </section>

      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt={`Imagen de la pregunta ${item.position}`}
          className="max-h-64 w-full rounded-md border object-contain"
        />
      ) : null}

      {/* Alternativas */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Alternativas</h3>
        {alternatives.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
            <FileQuestion className="size-5" aria-hidden />
            <span>Esta pregunta no tiene alternativas (no es de selección múltiple).</span>
          </div>
        ) : (
          <ul className="space-y-2">
            {alternatives.map((alt) => (
              <AlternativeRow
                key={alt.key}
                alt={alt}
                itemId={item.id}
                hasImage={imageKeys.has(alt.key)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Nodos asociados */}
      <QuestionNodes tags={toNodeTags(item.tags ?? [])} />

      {/* Edición asistida por IA (TKT-19) */}
      <ItemEditProposals itemId={item.id} instrumentId={instrumentId} canEdit={canEdit} />
    </div>
  );
}

function AlternativeRow({
  alt,
  itemId,
  hasImage,
}: {
  alt: Alternative;
  itemId: string;
  hasImage: boolean;
}): JSX.Element {
  return (
    <li
      className={cn(
        'flex items-start gap-2.5 rounded-md border px-3 py-2 text-sm',
        alt.isCorrect ? 'border-success/60 bg-success/10' : 'border-border',
      )}
    >
      <span
        className={cn(
          'inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
          alt.isCorrect ? 'border-success text-success' : 'border-border text-muted-foreground',
        )}
      >
        {alt.key}
      </span>
      {hasImage ? (
        // La alternativa ES una imagen: se muestra la figura, no el `text` (que es una
        // descripción de IA y filtraría la respuesta). La descripción va sólo en `alt`.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/items/${itemId}/alternativa/${alt.key}/figura`}
          alt={alt.text ?? `Alternativa ${alt.key}`}
          className="min-w-0 flex-1 max-h-48 rounded-md border bg-white object-contain"
        />
      ) : (
        <span className="min-w-0 flex-1 text-foreground">
          {alt.text ?? `Alternativa ${alt.key}`}
        </span>
      )}
      {alt.isCorrect ? (
        <CheckCircle2
          className="mt-0.5 size-4 shrink-0 text-success"
          aria-label="Alternativa correcta"
        />
      ) : null}
    </li>
  );
}
