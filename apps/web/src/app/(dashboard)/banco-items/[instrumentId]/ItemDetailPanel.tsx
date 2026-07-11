'use client';

import { useState, type JSX } from 'react';
import { BookOpen, CheckCircle2, FileQuestion, Sparkles } from 'lucide-react';
import type { ItemModel, ItemTaxonomyTagModel, InstrumentSectionModel } from '@soe/types';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  PassageDialog,
  hasPassageContent,
  type PassageAttachment,
  type PassageData,
} from '@/components/passage-dialog';
import { cn } from '@/lib/utils';
import { formatNodeCode } from '@/lib/taxonomy-labels';
import {
  useResizablePanelWidth,
  PanelResizeHandle,
} from '@/hooks/use-resizable-panel-width';
import { ItemEditProposals } from './ItemEditProposals';

function sectionToPassage(section: InstrumentSectionModel): PassageData {
  return {
    sectionName: section.name,
    passageTitle: section.passageTitle,
    passageText: section.passageText,
    passageFormat: section.passageFormat,
    attachments: (section.attachments ?? []).map<PassageAttachment>((a) => ({
      kind: a.kind,
      url: a.url,
      fileName: a.fileName,
      mimeType: a.mimeType,
      note: a.note,
    })),
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

export function ItemDetailPanel(props: {
  item: ItemModel | null;
  sections?: InstrumentSectionModel[];
  canEdit?: boolean;
  instrumentId?: string;
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const { item, sections = [], canEdit = false, instrumentId, open, onClose } = props;
  const [passageOpen, setPassageOpen] = useState(false);
  // El ancho del panel es ajustable arrastrando el borde izquierdo, persistido en
  // localStorage (mismo patrón que el panel del asistente y el de resultados).
  const { width, onPointerDown, onKeyDown } = useResizablePanelWidth({
    storageKey: 'soe.itemDetail.panelWidth',
    defaultWidth: 560,
    minWidth: 400,
  });

  const section = item?.sectionId ? (sections.find((s) => s.id === item.sectionId) ?? null) : null;
  const showPassage = hasPassageContent(section);

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent
        side="right"
        style={{ width, maxWidth: '95vw' }}
        className="w-full max-w-none overflow-y-auto"
      >
        {/* Tirador de redimensionado en el borde izquierdo (panel ancla derecha). */}
        <PanelResizeHandle onPointerDown={onPointerDown} onKeyDown={onKeyDown} />
        {/* Header SIEMPRE presente (Radix Dialog exige Title + Description). */}
        <SheetHeader className="space-y-2 pr-8">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{item ? `Pregunta ${item.position}` : 'Pregunta'}</Badge>
            {item ? (
              <Badge variant="outline">{ITEM_TYPE_LABELS[item.type] ?? item.type}</Badge>
            ) : null}
          </div>
          <SheetTitle className="text-base leading-snug">
            {item ? `Detalle de la pregunta ${item.position}` : 'Detalle de la pregunta'}
          </SheetTitle>
          <SheetDescription>
            Enunciado completo, alternativas y nodos de taxonomía asociados a la pregunta.
          </SheetDescription>
        </SheetHeader>

        {showPassage ? (
          <Button
            variant="outline"
            size="sm"
            className="mt-4 w-full justify-start gap-2"
            onClick={() => setPassageOpen(true)}
          >
            <BookOpen className="size-4" aria-hidden />
            Ver texto de lectura
          </Button>
        ) : null}

        {item ? (
          <ItemDetailContent
            item={item}
            canEdit={canEdit}
            instrumentId={instrumentId ?? item.instrumentId ?? ''}
          />
        ) : null}
      </SheetContent>

      {section ? (
        <PassageDialog
          open={passageOpen}
          onOpenChange={setPassageOpen}
          passage={sectionToPassage(section)}
        />
      ) : null}
    </Sheet>
  );
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
              <AlternativeRow key={alt.key} alt={alt} />
            ))}
          </ul>
        )}
      </section>

      {/* Nodos asociados */}
      <ItemNodes tags={item.tags ?? []} />

      {/* Edición asistida por IA (TKT-19) */}
      <ItemEditProposals itemId={item.id} instrumentId={instrumentId} canEdit={canEdit} />
    </div>
  );
}

function AlternativeRow({ alt }: { alt: Alternative }): JSX.Element {
  return (
    <li
      className={cn(
        'flex items-start gap-2.5 rounded-md border px-3 py-2 text-sm',
        alt.isCorrect
          ? 'border-emerald-500/60 bg-emerald-50 dark:bg-emerald-950/30'
          : 'border-border',
      )}
    >
      <span
        className={cn(
          'inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
          alt.isCorrect
            ? 'border-emerald-500 text-emerald-700 dark:text-emerald-300'
            : 'border-border text-muted-foreground',
        )}
      >
        {alt.key}
      </span>
      <span className="min-w-0 flex-1 text-foreground">{alt.text ?? `Alternativa ${alt.key}`}</span>
      {alt.isCorrect ? (
        <CheckCircle2
          className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-label="Alternativa correcta"
        />
      ) : null}
    </li>
  );
}

// Etiquetas legibles por tipo de nodo (taxonomy_node_type) y orden de aparición.
const NODE_TYPE_LABELS: Record<string, string> = {
  skill: 'Habilidades',
  content: 'Contenidos',
  learning_objective: 'Objetivos de aprendizaje',
  text_type: 'Tipos de texto',
  axis: 'Ejes',
  domain: 'Dominios',
  subdomain: 'Subdominios',
  performance_level: 'Niveles de desempeño',
  descriptor: 'Descriptores',
  criterion: 'Criterios',
  paper: 'Papers',
};

const NODE_TYPE_ORDER = Object.keys(NODE_TYPE_LABELS);

function nodeTypeRank(type: string): number {
  const i = NODE_TYPE_ORDER.indexOf(type);
  return i === -1 ? NODE_TYPE_ORDER.length : i;
}

/** Lista TODOS los nodos asociados al ítem, agrupados por tipo de nodo. */
function ItemNodes({ tags }: { tags: ItemTaxonomyTagModel[] }): JSX.Element {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Nodos asociados</h3>
      {tags.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Esta pregunta no tiene nodos de taxonomía asociados.
        </p>
      ) : (
        <div className="space-y-3">
          {groupTagsByType(tags).map(([type, group]) => (
            <div key={type} className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {NODE_TYPE_LABELS[type] ?? type}
              </p>
              <ul className="flex flex-wrap gap-2">
                {group.map((tag) => {
                  // TKT-03: mostrar "OA-{n}"/nombre humano, no el código técnico (LANG-…).
                  const codeLabel = formatNodeCode(tag.node?.code, tag.node?.type);
                  return (
                    <li key={tag.nodeId}>
                      <span className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-sm">
                        {codeLabel ? (
                          <span className="font-medium tabular-nums">{codeLabel}</span>
                        ) : null}
                        <span className="text-foreground">
                          {tag.node?.name ?? tag.nodeId.slice(0, 8)}
                        </span>
                        {/* TKT-06: se elimina el badge "secundario" (rótulo técnico
                          confuso). La distinción primary/secondary se mantiene solo
                          a nivel de datos. */}
                        {tag.taggedBy === 'ai' ? (
                          <Badge
                            variant="secondary"
                            className="ml-0.5 gap-0.5 px-1 py-0 text-[10px] font-normal"
                            title="Sugerido por IA"
                          >
                            <Sparkles className="size-2.5" aria-hidden />
                            IA
                          </Badge>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Agrupa los tags por el `type` del nodo, conservando el orden de relevancia. */
function groupTagsByType(tags: ItemTaxonomyTagModel[]): [string, ItemTaxonomyTagModel[]][] {
  const groups = new Map<string, ItemTaxonomyTagModel[]>();
  for (const tag of tags) {
    const type = tag.node?.type ?? 'unknown';
    const arr = groups.get(type) ?? [];
    arr.push(tag);
    groups.set(type, arr);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => nodeTypeRank(a) - nodeTypeRank(b));
}
