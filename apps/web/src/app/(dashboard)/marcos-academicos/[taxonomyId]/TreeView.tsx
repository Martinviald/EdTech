'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import type {
  CreateTaxonomyNodeDto,
  TaxonomyNodeModel as TaxonomyNode,
  TaxonomyNodeType,
  UpdateTaxonomyNodeDto,
} from '@soe/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { createTaxonomyNode, deleteTaxonomyNode, updateTaxonomyNode } from '../actions';

type Tree = TaxonomyNode & { children: Tree[] };

const NODE_TYPE_LABELS: Record<TaxonomyNodeType, string> = {
  domain: 'Dominio',
  subdomain: 'Subdominio',
  axis: 'Eje',
  learning_objective: 'OA',
  skill: 'Habilidad',
  content: 'Contenido',
  text_type: 'Tipo de texto',
  performance_level: 'Nivel de desempeño',
  descriptor: 'Descriptor',
  criterion: 'Criterio',
  paper: 'Documento',
};

const NODE_TYPES: TaxonomyNodeType[] = [
  'domain',
  'subdomain',
  'axis',
  'learning_objective',
  'skill',
  'content',
  'text_type',
  'performance_level',
  'descriptor',
  'criterion',
  'paper',
];

function buildTree(nodes: TaxonomyNode[]): Tree[] {
  const map = new Map<string, Tree>();
  for (const n of nodes) map.set(n.id, { ...n, children: [] });
  const roots: Tree[] = [];
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sort = (a: Tree, b: Tree) => a.order - b.order;
  roots.sort(sort);
  for (const n of map.values()) n.children.sort(sort);
  return roots;
}

function filterTree(tree: Tree[], q: string): Tree[] {
  if (!q.trim()) return tree;
  const needle = q.toLowerCase();
  const matches = (n: Tree): boolean =>
    n.name.toLowerCase().includes(needle) ||
    (n.code ?? '').toLowerCase().includes(needle) ||
    n.children.some(matches);
  function prune(nodes: Tree[]): Tree[] {
    return nodes.filter((n) => matches(n)).map((n) => ({ ...n, children: prune(n.children) }));
  }
  return prune(tree);
}

type FormState =
  | { kind: 'closed' }
  | { kind: 'create'; parent: TaxonomyNode | null }
  | { kind: 'edit'; node: TaxonomyNode };

export function TreeView({
  taxonomyId,
  nodes,
  editable,
}: {
  taxonomyId: string;
  nodes: TaxonomyNode[];
  editable: boolean;
}) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<FormState>({ kind: 'closed' });

  const tree = useMemo(() => buildTree(nodes), [nodes]);
  const filtered = useMemo(() => filterTree(tree, query), [tree, query]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Buscar por nombre o código…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
        {editable && (
          <Button onClick={() => setForm({ kind: 'create', parent: null })}>
            <Plus className="mr-1 size-4" /> Agregar nodo raíz
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="text-muted-foreground rounded-md border border-dashed p-8 text-center text-sm">
          {nodes.length === 0
            ? 'Este marco académico aún no tiene nodos.'
            : 'Ningún nodo coincide con la búsqueda.'}
        </div>
      ) : (
        <ul className="space-y-1">
          {filtered.map((n) => (
            <NodeRow
              key={n.id}
              node={n}
              depth={0}
              expanded={expanded}
              onToggle={toggle}
              editable={editable}
              onAddChild={(parent) => setForm({ kind: 'create', parent })}
              onEdit={(node) => setForm({ kind: 'edit', node })}
              taxonomyId={taxonomyId}
            />
          ))}
        </ul>
      )}

      <NodeFormDialog
        state={form}
        taxonomyId={taxonomyId}
        onClose={() => setForm({ kind: 'closed' })}
      />
    </div>
  );
}

function NodeRow({
  node,
  depth,
  expanded,
  onToggle,
  editable,
  onAddChild,
  onEdit,
  taxonomyId,
}: {
  node: Tree;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  editable: boolean;
  onAddChild: (parent: TaxonomyNode) => void;
  onEdit: (node: TaxonomyNode) => void;
  taxonomyId: string;
}) {
  const isOpen = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleDelete() {
    const confirmed = window.confirm(
      hasChildren
        ? `¿Eliminar "${node.name}" y sus ${node.children.length} hijo(s)?`
        : `¿Eliminar "${node.name}"?`,
    );
    if (!confirmed) return;
    startTransition(async () => {
      try {
        await deleteTaxonomyNode(node.id, taxonomyId, hasChildren);
        toast.success('Nodo eliminado');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al eliminar');
      }
    });
  }

  return (
    <li>
      <div
        className="group flex items-center gap-2 rounded-md py-1.5 pr-2 hover:bg-muted/50"
        style={{ paddingLeft: `${depth * 1.25 + 0.25}rem` }}
      >
        <button
          type="button"
          onClick={() => hasChildren && onToggle(node.id)}
          className="text-muted-foreground hover:text-foreground inline-flex size-5 items-center justify-center"
          aria-label={isOpen ? 'Colapsar' : 'Expandir'}
        >
          {hasChildren ? (
            isOpen ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )
          ) : (
            <span className="block size-4" />
          )}
        </button>

        <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-medium uppercase">
          {NODE_TYPE_LABELS[node.type as TaxonomyNodeType] ?? node.type}
        </span>

        {node.code && <span className="text-muted-foreground font-mono text-xs">{node.code}</span>}

        <span className="flex-1 truncate text-sm">{node.name}</span>

        {editable && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onAddChild(node)}
              disabled={pending}
              title="Agregar hijo"
            >
              <Plus className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onEdit(node)}
              disabled={pending}
              title="Editar"
            >
              <Pencil className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              disabled={pending}
              title="Eliminar"
            >
              <Trash2 className="text-destructive size-4" />
            </Button>
          </div>
        )}
      </div>

      {hasChildren && isOpen && (
        <ul className="space-y-1">
          {node.children.map((child) => (
            <NodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              editable={editable}
              onAddChild={onAddChild}
              onEdit={onEdit}
              taxonomyId={taxonomyId}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function NodeFormDialog({
  state,
  taxonomyId,
  onClose,
}: {
  state: FormState;
  taxonomyId: string;
  onClose: () => void;
}) {
  const open = state.kind !== 'closed';
  const isEdit = state.kind === 'edit';
  const initial = state.kind === 'edit' ? state.node : null;
  const parent = state.kind === 'create' ? state.parent : null;

  const [name, setName] = useState(initial?.name ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [type, setType] = useState<TaxonomyNodeType>(
    (initial?.type as TaxonomyNodeType) ?? 'domain',
  );
  const [description, setDescription] = useState(initial?.description ?? '');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  // Reset form when dialog opens for a different node
  useMemo(() => {
    if (state.kind === 'edit') {
      setName(state.node.name);
      setCode(state.node.code ?? '');
      setType(state.node.type as TaxonomyNodeType);
      setDescription(state.node.description ?? '');
    } else if (state.kind === 'create') {
      setName('');
      setCode('');
      setType('domain');
      setDescription('');
    }
  }, [state]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('El nombre es obligatorio');
      return;
    }
    startTransition(async () => {
      try {
        if (state.kind === 'edit') {
          const dto: UpdateTaxonomyNodeDto = {
            name: name.trim(),
            code: code.trim() || undefined,
            type,
            description: description.trim() || undefined,
          };
          await updateTaxonomyNode(state.node.id, taxonomyId, dto);
          toast.success('Nodo actualizado');
        } else {
          const dto: CreateTaxonomyNodeDto = {
            taxonomyId,
            parentId: parent?.id ?? null,
            type,
            name: name.trim(),
            code: code.trim() || undefined,
            description: description.trim() || undefined,
            order: 0,
          };
          await createTaxonomyNode(dto);
          toast.success('Nodo creado');
        }
        onClose();
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al guardar');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>
              {isEdit
                ? 'Editar nodo'
                : parent
                  ? `Nuevo hijo de "${parent.name}"`
                  : 'Nuevo nodo raíz'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="node-type">
                Tipo
              </label>
              <select
                id="node-type"
                value={type}
                onChange={(e) => setType(e.target.value as TaxonomyNodeType)}
                disabled={pending}
                className="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-9 w-full rounded-md border px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1"
              >
                {NODE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {NODE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="node-code">
                Código (opcional)
              </label>
              <Input
                id="node-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Ej: OA3"
                disabled={pending}
                maxLength={50}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="node-name">
                Nombre
              </label>
              <Input
                id="node-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={pending}
                required
                minLength={1}
                maxLength={500}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="node-desc">
                Descripción (opcional)
              </label>
              <textarea
                id="node-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={pending}
                maxLength={2000}
                rows={3}
                className="border-input bg-background ring-offset-background focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Guardando…' : isEdit ? 'Guardar' : 'Crear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
