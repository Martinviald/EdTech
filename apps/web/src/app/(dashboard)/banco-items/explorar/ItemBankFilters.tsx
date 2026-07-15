'use client';

// Filtros del banco de ítems — modelo "Ámbito → Dimensión".
//
//   Fila 1 (ámbito):     Asignatura + Nivel  → acotan todo lo de abajo.
//   Fila 2 (dimensión):  un control por cada TIPO HOJA presente en el ámbito
//                        (Objetivo de aprendizaje, Habilidad, Tipo de texto…),
//                        poblado dinámicamente desde el árbol de taxonomía.
//
// Lo que evita la confusión previa (dropdowns planos por `type`):
//   · Solo se ofrecen los TIPOS HOJA (los que etiquetan ítems). El andamiaje
//     estructural (dominio/subdominio/eje) NO es un filtro por sí mismo.
//   · Un tipo hoja con MUCHOS nodos y >1 padre en el ámbito muestra un
//     "narrower" = el tipo del nivel padre (p. ej. Eje para OA). Es genérico:
//     se deriva del árbol, no está hardcodeado a "Eje".
//   · Asignatura/Nivel son el ámbito superior (no un dropdown más), y acotan
//     cada lista respetando NULL = transversal (una Habilidad sin nivel no
//     desaparece al elegir un nivel).
//
// El acotamiento de OPCIONES es client-side e instantáneo (el set curricular es
// pequeño). El filtrado de ÍTEMS es server-side: esto solo escribe la selección
// en la URL (patrón de `ItemBankScopeSelect`) y el Server Component refetchea.

import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { X } from 'lucide-react';
import { TAXONOMY_NODE_TYPES, type CatalogEntryModel, type TaxonomyNodeModel } from '@soe/types';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { nodeTypeLabel, nodeOptionLabel } from '@/lib/taxonomy-labels';
import { NodeTypeFilter } from './NodeTypeFilter';

const ALL = '__all__';

/** @deprecated Alias del contrato compartido; importar `CatalogEntryModel` de `@soe/types`. */
export type CatalogEntry = CatalogEntryModel;

interface ItemBankFiltersProps {
  subjects: CatalogEntry[];
  grades: CatalogEntry[];
  /** Todos los nodos del marco curricular (para poblar y acotar los filtros). */
  nodes: TaxonomyNodeModel[];
  subjectId?: string;
  gradeId?: string;
  /** Ids seleccionados por tipo HOJA (clave = TaxonomyNodeType hoja). */
  selectedLeaf: Record<string, string[]>;
  /** Id del padre elegido por tipo PADRE/narrower (clave = TaxonomyNodeType padre). */
  selectedParent: Record<string, string>;
}

export function ItemBankFilters({
  subjects,
  grades,
  nodes,
  subjectId,
  gradeId,
  selectedLeaf,
  selectedParent,
}: ItemBankFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const pushParams = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const qs = params.toString();
    router.push((qs ? `/banco-items/explorar?${qs}` : '/banco-items/explorar') as Route);
  };

  /** Borra toda la selección de nodos (tipos hoja y padres) al cambiar el ámbito. */
  const clearNodeSelections = (params: URLSearchParams) => {
    for (const type of TAXONOMY_NODE_TYPES) params.delete(type);
  };

  const onSubjectChange = (next: string) =>
    pushParams((params) => {
      if (next === ALL) params.delete('subjectId');
      else params.set('subjectId', next);
      clearNodeSelections(params);
    });

  const onGradeChange = (next: string) =>
    pushParams((params) => {
      if (next === ALL) params.delete('gradeId');
      else params.set('gradeId', next);
      clearNodeSelections(params);
    });

  const onLeafChange = (leafType: string, ids: string[]) =>
    pushParams((params) => {
      if (ids.length === 0) params.delete(leafType);
      else params.set(leafType, ids.join(','));
    });

  // Cambiar el narrower (padre) limpia la selección del tipo hoja que acota.
  const onParentChange = (parentType: string, leafType: string, id: string) =>
    pushParams((params) => {
      if (id === ALL) params.delete(parentType);
      else params.set(parentType, id);
      params.delete(leafType);
    });

  const clearAll = () =>
    pushParams((params) => {
      params.delete('subjectId');
      params.delete('gradeId');
      clearNodeSelections(params);
    });

  // ── Derivaciones desde el árbol (dinámicas) ─────────────────────────────────
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // Un nodo es "estructural" si es padre de otro; su TIPO es estructural.
  const parentIds = new Set(nodes.map((n) => n.parentId).filter((p): p is string => Boolean(p)));
  const structuralTypes = new Set(
    nodes.filter((n) => parentIds.has(n.id)).map((n) => n.type),
  );
  // Dimensiones = tipos HOJA presentes (los que etiquetan ítems), en orden canónico.
  const presentTypes = new Set(nodes.map((n) => n.type));
  const leafTypes = TAXONOMY_NODE_TYPES.filter(
    (t) => presentTypes.has(t) && !structuralTypes.has(t),
  );

  // Un nodo pasa el ámbito si su asignatura/nivel coincide o es NULL (transversal).
  const matchesScope = (n: TaxonomyNodeModel) => {
    if (subjectId && n.subjectId && n.subjectId !== subjectId) return false;
    if (gradeId && n.gradeId && n.gradeId !== gradeId) return false;
    return true;
  };

  // Ámbito: solo asignaturas/niveles presentes en el árbol curricular.
  const presentSubjectIds = new Set(nodes.map((n) => n.subjectId).filter(Boolean));
  const presentGradeIds = new Set(nodes.map((n) => n.gradeId).filter(Boolean));
  const availableSubjects = subjects.filter((s) => presentSubjectIds.has(s.id));
  const availableGrades = grades.filter((g) => presentGradeIds.has(g.id));

  // Config de cada dimensión: opciones acotadas + narrower opcional (tipo padre).
  const dimensions = leafTypes
    .map((leafType) => {
      const scoped = nodes.filter((n) => n.type === leafType && matchesScope(n));
      if (scoped.length === 0) return null;

      // Padres distintos (que existan como nodo) dentro del ámbito.
      const parentNodes = [...new Set(scoped.map((n) => n.parentId).filter(Boolean))]
        .map((id) => nodeById.get(id as string))
        .filter((n): n is TaxonomyNodeModel => Boolean(n));

      let narrower: {
        parentType: string;
        label: string;
        options: { id: string; label: string }[];
        selected: string;
      } | null = null;
      let optionNodes = scoped;

      if (parentNodes.length > 1) {
        const parentType = parentNodes[0]!.type;
        const selected = selectedParent[parentType] ?? '';
        narrower = {
          parentType,
          label: nodeTypeLabel(parentType) ?? parentType,
          options: parentNodes
            .map((p) => ({ id: p.id, label: nodeOptionLabel(p) }))
            .sort((a, b) => a.label.localeCompare(b.label)),
          selected,
        };
        if (selected) optionNodes = scoped.filter((n) => n.parentId === selected);
      }

      return {
        leafType,
        label: nodeTypeLabel(leafType) ?? leafType,
        narrower,
        options: optionNodes
          .map((n) => ({ id: n.id, label: nodeOptionLabel(n) }))
          .sort((a, b) => a.label.localeCompare(b.label)),
        selected: selectedLeaf[leafType] ?? [],
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);

  const hasAnyFilter =
    Boolean(subjectId) ||
    Boolean(gradeId) ||
    Object.values(selectedLeaf).some((ids) => ids.length > 0) ||
    Object.keys(selectedParent).length > 0;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Asignatura
        </span>
        <Select value={subjectId ?? ALL} onValueChange={onSubjectChange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Asignatura" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas las asignaturas</SelectItem>
            {availableSubjects.map((subject) => (
              <SelectItem key={subject.id} value={subject.id}>
                {subject.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Nivel
        </span>
        <Select value={gradeId ?? ALL} onValueChange={onGradeChange}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Nivel" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los niveles</SelectItem>
            {availableGrades.map((grade) => (
              <SelectItem key={grade.id} value={grade.id}>
                {grade.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {dimensions.map((dim) => (
        <div key={dim.leafType} className="flex flex-wrap items-end gap-3">
          {dim.narrower && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {dim.narrower.label}
              </span>
              <Select
                value={dim.narrower.selected || ALL}
                onValueChange={(id) =>
                  onParentChange(dim.narrower!.parentType, dim.leafType, id)
                }
              >
                <SelectTrigger className="w-[190px]">
                  <SelectValue placeholder={dim.narrower.label} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos</SelectItem>
                  {dim.narrower.options.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {dim.label}
            </span>
            <NodeTypeFilter
              label={dim.label}
              options={dim.options}
              selected={dim.selected}
              onChange={(ids) => onLeafChange(dim.leafType, ids)}
            />
          </div>
        </div>
      ))}

      {hasAnyFilter && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1 px-2 text-xs text-muted-foreground"
          onClick={clearAll}
        >
          <X className="size-3" aria-hidden />
          Limpiar filtros
        </Button>
      )}
    </div>
  );
}
