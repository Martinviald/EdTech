'use client';

import type { JSX } from 'react';
import type { ItemModel, ItemTaxonomyTagModel, InstrumentSectionModel } from '@soe/types';
import { ITEM_DIFFICULTY_LABELS, ITEM_TYPE_LABELS, deriveAnswerKey } from '@soe/types';
import { Badge } from '@/components/ui/badge';
import {
  hasPassageContent,
  toPassageAttachments,
  type PassageData,
} from '@/components/passage-dialog';
import { QuestionDetailSheet } from '@/components/question-detail/question-detail-sheet';
import { QuestionNodes, type QuestionNodeTag } from '@/components/question-detail/question-nodes';
import { AnswerKeyView } from '@/components/items/answer-key-view';
import { AddToCollectionMenu } from '@/components/collections/add-to-collection-menu';
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

/** Extrae el enunciado del ítem desde el `content` JSONB (varios alias posibles). */
function getStem(content: Record<string, unknown>): string | null {
  for (const field of ['stem', 'text', 'prompt', 'question'] as const) {
    if (typeof content[field] === 'string' && content[field]) {
      return content[field] as string;
    }
  }
  return null;
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
  canAddToCollection?: boolean;
  instrumentId?: string;
  instrumentName?: string;
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const {
    item,
    sections = [],
    canEdit = false,
    canAddToCollection = false,
    instrumentId,
    instrumentName,
    open,
    onClose,
  } = props;

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
        item ? (
          <>
            <Badge variant="outline">{ITEM_TYPE_LABELS[item.type] ?? item.type}</Badge>
            {item.difficulty ? (
              <Badge variant="secondary">{ITEM_DIFFICULTY_LABELS[item.difficulty]}</Badge>
            ) : null}
          </>
        ) : null
      }
      headerActions={
        item && canAddToCollection ? <AddToCollectionMenu itemId={item.id} /> : undefined
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
          instrumentName={instrumentName}
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
  instrumentName,
}: {
  item: ItemModel;
  canEdit: boolean;
  instrumentId: string;
  instrumentName?: string;
}): JSX.Element {
  const content = item.content ?? {};
  const stem = getStem(content);
  const imageUrl = getStringField(content, 'imageUrl');
  const explanation = getStringField(content, 'explanation');
  const imageKeys = altImageKeys(item);
  const answerKey = deriveAnswerKey(item.type, content);
  const answerKeyLabel =
    answerKey.kind === 'choice' || answerKey.kind === 'multi_choice'
      ? 'Alternativas'
      : answerKey.kind === 'matching'
        ? 'Pares correctos'
        : 'Respuesta correcta';

  return (
    <div className="mt-6 space-y-6">
      {instrumentName ? (
        <p className="text-xs text-muted-foreground">
          Instrumento de origen:{' '}
          <span className="font-medium text-foreground">{instrumentName}</span>
        </p>
      ) : null}

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

      {/* Respuesta correcta / pauta: normalizada por tipo de ítem */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">{answerKeyLabel}</h3>
        <AnswerKeyView answerKey={answerKey} itemId={item.id} imageAltKeys={imageKeys} />
      </section>

      {/* Nodos asociados */}
      <QuestionNodes tags={toNodeTags(item.tags ?? [])} />

      {/* Edición asistida por IA (TKT-19) */}
      <ItemEditProposals itemId={item.id} instrumentId={instrumentId} canEdit={canEdit} />
    </div>
  );
}
