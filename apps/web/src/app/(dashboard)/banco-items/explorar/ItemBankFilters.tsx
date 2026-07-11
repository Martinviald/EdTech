'use client';

// Barra de filtros en cascada del banco de ítems:
//   Asignatura + Nivel  →  acotan las opciones de cada dropdown por tipo de nodo.
//   Un dropdown por cada tipo de nodo presente (Descriptor, OA, Habilidad, Tipo de
//   texto…), poblado dinámicamente desde los árboles de la BDD (facets), ya
//   acotado por asignatura/nivel en el servidor.
//
// Escribe todos los filtros en la URL (patrón de `ItemBankScopeSelect`) para que
// el Server Component vuelva a pedir los nodos acotados y los ítems filtrados. Al
// cambiar asignatura/nivel se limpian las selecciones por tipo (quedarían
// inválidas al cambiar de árbol).

import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { X } from 'lucide-react';
import { TAXONOMY_NODE_TYPES, type TaxonomyNodeModel } from '@soe/types';
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

export type CatalogEntry = { id: string; name: string; shortName: string };

interface ItemBankFiltersProps {
  subjects: CatalogEntry[];
  grades: CatalogEntry[];
  /** Nodos ya acotados por asignatura/nivel (para poblar los dropdowns por tipo). */
  facetNodes: TaxonomyNodeModel[];
  subjectId?: string;
  gradeId?: string;
  /** Ids seleccionados por tipo de nodo (clave = TaxonomyNodeType). */
  selectedByType: Record<string, string[]>;
}

export function ItemBankFilters({
  subjects,
  grades,
  facetNodes,
  subjectId,
  gradeId,
  selectedByType,
}: ItemBankFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const pushParams = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const qs = params.toString();
    router.push((qs ? `/banco-items/explorar?${qs}` : '/banco-items/explorar') as Route);
  };

  /** Borra todas las selecciones por tipo (al cambiar de asignatura/nivel). */
  const clearNodeTypes = (params: URLSearchParams) => {
    for (const type of TAXONOMY_NODE_TYPES) params.delete(type);
  };

  const onSubjectChange = (next: string) => {
    pushParams((params) => {
      if (next === ALL) params.delete('subjectId');
      else params.set('subjectId', next);
      clearNodeTypes(params);
    });
  };

  const onGradeChange = (next: string) => {
    pushParams((params) => {
      if (next === ALL) params.delete('gradeId');
      else params.set('gradeId', next);
      clearNodeTypes(params);
    });
  };

  const onNodeTypeChange = (type: string, ids: string[]) => {
    pushParams((params) => {
      if (ids.length === 0) params.delete(type);
      else params.set(type, ids.join(','));
    });
  };

  const clearAll = () => {
    pushParams((params) => {
      params.delete('subjectId');
      params.delete('gradeId');
      clearNodeTypes(params);
    });
  };

  // Agrupar los facets por tipo, preservando el orden canónico de tipos.
  const optionsByType = new Map<string, { id: string; label: string }[]>();
  for (const node of facetNodes) {
    const list = optionsByType.get(node.type) ?? [];
    list.push({ id: node.id, label: nodeOptionLabel(node) });
    optionsByType.set(node.type, list);
  }
  const presentTypes = TAXONOMY_NODE_TYPES.filter((type) => optionsByType.has(type));

  const hasAnyFilter =
    Boolean(subjectId) ||
    Boolean(gradeId) ||
    Object.values(selectedByType).some((ids) => ids.length > 0);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={subjectId ?? ALL} onValueChange={onSubjectChange}>
        <SelectTrigger className="w-[190px]">
          <SelectValue placeholder="Asignatura" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todas las asignaturas</SelectItem>
          {subjects.map((subject) => (
            <SelectItem key={subject.id} value={subject.id}>
              {subject.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={gradeId ?? ALL} onValueChange={onGradeChange}>
        <SelectTrigger className="w-[170px]">
          <SelectValue placeholder="Nivel" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos los niveles</SelectItem>
          {grades.map((grade) => (
            <SelectItem key={grade.id} value={grade.id}>
              {grade.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {presentTypes.map((type) => (
        <NodeTypeFilter
          key={type}
          label={nodeTypeLabel(type) ?? type}
          options={optionsByType.get(type) ?? []}
          selected={selectedByType[type] ?? []}
          onChange={(ids) => onNodeTypeChange(type, ids)}
        />
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
