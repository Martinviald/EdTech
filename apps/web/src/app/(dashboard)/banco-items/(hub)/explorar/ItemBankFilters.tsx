'use client';

// Filtros del banco de ítems — modelo "Ámbito → Dimensión".
//
//   Ámbito:     Asignatura + Nivel  → acotan todo lo demás.
//   Dimensión:  un control por cada TIPO HOJA presente en el ámbito
//               (Objetivo de aprendizaje, Habilidad, Tipo de texto…),
//               poblado dinámicamente desde el árbol de taxonomía.
//
// Solo se ofrecen los TIPOS HOJA (los que etiquetan ítems); el andamiaje
// estructural (dominio/subdominio/eje) no es un filtro por sí mismo salvo como
// "narrower" cuando un tipo hoja tiene muchos nodos con >1 padre en el ámbito.
//
// El acotamiento de OPCIONES es client-side; el filtrado de ÍTEMS es server-side:
// esto solo escribe la selección en la URL y el Server Component refetchea.

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { FilterX } from 'lucide-react';
import { TAXONOMY_NODE_TYPES, type CatalogEntryModel, type TaxonomyNodeModel } from '@soe/types';
import { Button } from '@/components/ui/button';
import { FilterBar, type FilterField } from '@/components/shared';
import { nodeTypeLabel, nodeOptionLabel } from '@/lib/taxonomy-labels';
import { ROUTES } from '@/lib/routes';
import { NodeTypeFilter } from './NodeTypeFilter';

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
  const [isPending, startTransition] = useTransition();

  const pushParams = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const qs = params.toString();
    startTransition(() => {
      router.push((qs ? `${ROUTES.bancoItemsExplorar}?${qs}` : ROUTES.bancoItemsExplorar) as Route);
    });
  };

  /** Borra toda la selección de nodos (tipos hoja y padres) al cambiar el ámbito. */
  const clearNodeSelections = (params: URLSearchParams) => {
    for (const type of TAXONOMY_NODE_TYPES) params.delete(type);
  };

  const onSubjectChange = (next: string) =>
    pushParams((params) => {
      if (next) params.set('subjectId', next);
      else params.delete('subjectId');
      clearNodeSelections(params);
    });

  const onGradeChange = (next: string) =>
    pushParams((params) => {
      if (next) params.set('gradeId', next);
      else params.delete('gradeId');
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
      if (id) params.set(parentType, id);
      else params.delete(parentType);
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
  const structuralTypes = new Set(nodes.filter((n) => parentIds.has(n.id)).map((n) => n.type));
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

  const fields: FilterField[] = [
    {
      key: 'subjectId',
      label: 'Asignatura',
      placeholder: 'Todas las asignaturas',
      value: subjectId,
      options: availableSubjects.map((s) => ({ id: s.id, label: s.name })),
      onChange: onSubjectChange,
    },
    {
      key: 'gradeId',
      label: 'Nivel',
      placeholder: 'Todos los niveles',
      value: gradeId,
      options: availableGrades.map((g) => ({ id: g.id, label: g.name })),
      onChange: onGradeChange,
    },
    ...dimensions.flatMap((dim): FilterField[] => {
      const cells: FilterField[] = [];
      const narrower = dim.narrower;
      if (narrower) {
        cells.push({
          key: narrower.parentType,
          label: narrower.label,
          placeholder: `Todos`,
          value: narrower.selected || undefined,
          options: narrower.options,
          onChange: (id) => onParentChange(narrower.parentType, dim.leafType, id),
        });
      }
      cells.push({
        key: dim.leafType,
        label: dim.label,
        control: (
          <NodeTypeFilter
            label={dim.label}
            placeholder="Seleccionar"
            fullWidth
            options={dim.options}
            selected={dim.selected}
            onChange={(ids) => onLeafChange(dim.leafType, ids)}
          />
        ),
      });
      return cells;
    }),
  ];

  return (
    <FilterBar
      layout="grid"
      fields={fields}
      pending={isPending}
      actions={
        <Button
          variant="ghost"
          size="icon"
          onClick={clearAll}
          disabled={!hasAnyFilter}
          title="Limpiar filtros"
          aria-label="Limpiar filtros"
        >
          <FilterX />
        </Button>
      }
    />
  );
}
