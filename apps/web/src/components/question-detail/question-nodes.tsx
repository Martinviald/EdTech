'use client';

// Sección "Nodos asociados" compartida por los paneles laterales de detalle de
// pregunta (banco de ítems y resultados). Recibe los tags YA normalizados a
// `QuestionNodeTag` para no acoplarse a la forma concreta de cada origen
// (`ItemTaxonomyTagModel` vs `QuestionTaxonomyTag`). Antes esta sección estaba
// duplicada casi verbatim en ambos paneles.

import type { JSX } from 'react';
import { Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatNodeCode } from '@/lib/taxonomy-labels';

/** Tag de taxonomía normalizado para mostrar en un panel de detalle de pregunta. */
export type QuestionNodeTag = {
  nodeId: string;
  code: string | null;
  type: string;
  name: string;
  taggedBy?: string | null;
};

// Etiquetas legibles (plural) por tipo de nodo (taxonomy_node_type) y su orden de
// aparición en el panel.
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

/** Agrupa los tags por tipo de nodo, conservando el orden de relevancia. */
function groupTagsByType(tags: QuestionNodeTag[]): [string, QuestionNodeTag[]][] {
  const groups = new Map<string, QuestionNodeTag[]>();
  for (const tag of tags) {
    const arr = groups.get(tag.type) ?? [];
    arr.push(tag);
    groups.set(tag.type, arr);
  }
  return Array.from(groups.entries()).sort(([a], [b]) => nodeTypeRank(a) - nodeTypeRank(b));
}

/**
 * Lista los nodos de taxonomía asociados a una pregunta, agrupados por tipo.
 * `hiddenTypes` permite ocultar tipos según el contexto (p. ej. resultados oculta
 * los `descriptor`, TKT-05, que solo se ven en el banco de ítems).
 */
export function QuestionNodes({
  tags,
  hiddenTypes,
}: {
  tags: QuestionNodeTag[];
  hiddenTypes?: readonly string[];
}): JSX.Element {
  const hidden = new Set(hiddenTypes ?? []);
  const visibleTags = tags.filter((tag) => !hidden.has(tag.type));

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Nodos asociados</h3>
      {visibleTags.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Esta pregunta no tiene nodos de taxonomía asociados.
        </p>
      ) : (
        <div className="space-y-3">
          {groupTagsByType(visibleTags).map(([type, group]) => (
            <div key={type} className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {NODE_TYPE_LABELS[type] ?? type}
              </p>
              <ul className="flex flex-wrap gap-2">
                {group.map((tag) => {
                  // TKT-03: mostrar "OA-{n}"/nombre humano, no el código técnico (LANG-…).
                  const codeLabel = formatNodeCode(tag.code, tag.type);
                  return (
                    <li key={tag.nodeId}>
                      <span className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-sm">
                        {codeLabel ? (
                          <span className="font-medium tabular-nums">{codeLabel}</span>
                        ) : null}
                        <span className="text-foreground">
                          {tag.name || tag.nodeId.slice(0, 8)}
                        </span>
                        {/* TKT-06: sin badge "secundario" (rótulo técnico confuso);
                          la distinción primary/secondary vive solo en los datos. */}
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
