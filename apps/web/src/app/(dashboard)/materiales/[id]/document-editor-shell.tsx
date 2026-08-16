'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, Copy, Eye, Loader2, Pencil, Printer, TriangleAlert } from 'lucide-react';
import type { Route } from 'next';
import {
  DOCUMENT_CONTENT_VERSION,
  type Block,
  type CatalogEntryModel,
  type DocumentModel,
  type UpdateDocumentDto,
} from '@soe/types';
import { ROUTES } from '@/lib/routes';
import { apiClientPatch } from '@/lib/api-client';
import { getDisplayMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AlertCallout } from '@/components/shared';
import { DocumentCanvas } from '@/components/document-editor/document-canvas';
import { DocumentRenderer } from '@/components/document-editor/document-renderer';
import { BLOCK_TYPE_ORDER } from '@/components/document-editor/block-registry';
import { duplicateDocument } from '../actions';
import { ItemPickerDialog } from './item-picker-dialog';
import { CustomizeItemDialog } from './customize-item-dialog';
import { SpecificationDialog } from './specification-dialog';
import { PromoteButton } from './promote-button';

const AUTOSAVE_DELAY_MS = 1500;

// Los bloques `item` referencian filas vivas de `items`; se insertan desde el
// picker del banco, no fabricados en blanco desde el insertador.
const INSERTABLE_TYPES = BLOCK_TYPE_ORDER.filter((type) => type !== 'item');

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

type Mode = 'edit' | 'preview';

type ItemBlockType = Extract<Block, { type: 'item' }>;

type DocumentEditorShellProps = {
  document: DocumentModel;
  canEdit: boolean;
  subjects: CatalogEntryModel[];
  grades: CatalogEntryModel[];
};

export function DocumentEditorShell({
  document,
  canEdit,
  subjects,
  grades,
}: DocumentEditorShellProps) {
  const router = useRouter();
  const [title, setTitle] = useState(document.title);
  const [blocks, setBlocks] = useState<Block[]>(document.content.blocks);
  const [instrumentId, setInstrumentId] = useState(document.instrumentId);
  const [mode, setMode] = useState<Mode>(canEdit ? 'edit' : 'preview');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [editingItemBlock, setEditingItemBlock] = useState<ItemBlockType | null>(null);
  const [isDuplicating, setIsDuplicating] = useState(false);

  const draftRef = useRef({ title: document.title, blocks: document.content.blocks });
  const savingRef = useRef(false);
  const queuedRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  function scheduleSave(nextTitle: string, nextBlocks: Block[]) {
    draftRef.current = { title: nextTitle, blocks: nextBlocks };
    setSaveState('dirty');
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
  }

  async function flush() {
    if (savingRef.current) {
      queuedRef.current = true;
      return;
    }
    savingRef.current = true;
    setSaveState('saving');
    const draft = draftRef.current;
    const body: UpdateDocumentDto = {
      content: { version: DOCUMENT_CONTENT_VERSION, blocks: draft.blocks },
    };
    if (draft.title.trim()) body.title = draft.title;
    try {
      await apiClientPatch<DocumentModel>(`/documents/${document.id}`, body);
      savingRef.current = false;
      if (queuedRef.current) {
        queuedRef.current = false;
        void flush();
        return;
      }
      setSaveState('saved');
    } catch (error) {
      savingRef.current = false;
      queuedRef.current = false;
      setSaveState('error');
      toast.error(getDisplayMessage(error, 'No se pudo guardar el material'));
    }
  }

  function handleTitleChange(next: string) {
    setTitle(next);
    scheduleSave(next, blocks);
  }

  function handleBlocksChange(next: Block[]) {
    setBlocks(next);
    scheduleSave(title, next);
  }

  // Tras customize/promote el backend re-apunta bloques (copy-on-write) y fija
  // instrumentId; su respuesta es autoritativa. Se cancela el autosave pendiente
  // para que un borrador viejo no pise los bloques re-apuntados.
  function applyServerDocument(updated: DocumentModel) {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    draftRef.current = { title: updated.title, blocks: updated.content.blocks };
    setBlocks(updated.content.blocks);
    setInstrumentId(updated.instrumentId);
    setSaveState('saved');
  }

  function handleInsertItems(newBlocks: Block[]) {
    handleBlocksChange([...blocks, ...newBlocks]);
  }

  function handleDuplicate() {
    setIsDuplicating(true);
    void duplicateDocument(document.id).then((result) => {
      setIsDuplicating(false);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success('Copia creada. Ya puedes editarla.');
      router.push(ROUTES.material(result.data.id) as Route);
    });
  }

  const hasItems = blocks.some((block) => block.type === 'item');

  if (!canEdit) {
    return (
      <div className="space-y-4">
        <AlertCallout tone="info" title="Material de otro docente">
          Solo el creador puede editar este material. Duplícalo para hacer tu propia versión
          editable.
        </AlertCallout>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={Copy}
            disabled={isDuplicating}
            onClick={handleDuplicate}
          >
            {isDuplicating ? 'Duplicando…' : 'Duplicar para editar'}
          </Button>
          <Button asChild type="button" variant="outline" size="sm" icon={Printer}>
            <Link href={ROUTES.materialImprimir(document.id) as Route}>Imprimir</Link>
          </Button>
        </div>
        <div className="rounded-xl border border-border bg-card p-6 sm:p-10">
          <DocumentRenderer
            content={{ version: DOCUMENT_CONTENT_VERSION, blocks }}
            audience="teacher"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={title}
          placeholder="Título del material"
          aria-label="Título del material"
          className="max-w-md flex-1 font-medium"
          onChange={(event) => handleTitleChange(event.target.value)}
        />
        <SaveIndicator state={saveState} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SpecificationDialog documentId={document.id} />
          <PromoteButton
            documentId={document.id}
            instrumentId={instrumentId}
            hasItems={hasItems}
            onPromoted={applyServerDocument}
          />
          <Button asChild type="button" variant="outline" size="sm" icon={Printer}>
            <Link href={ROUTES.materialImprimir(document.id) as Route}>Imprimir</Link>
          </Button>
          <div className="inline-flex items-center gap-0.5 rounded-lg border border-border p-0.5">
            <Button
              type="button"
              size="sm"
              variant={mode === 'edit' ? 'secondary' : 'ghost'}
              icon={Pencil}
              onClick={() => setMode('edit')}
            >
              Edición
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'preview' ? 'secondary' : 'ghost'}
              icon={Eye}
              onClick={() => setMode('preview')}
            >
              Vista previa
            </Button>
          </div>
        </div>
      </div>

      {mode === 'edit' ? (
        <DocumentCanvas
          value={blocks}
          onChange={handleBlocksChange}
          insertableTypes={INSERTABLE_TYPES}
          onEditItem={setEditingItemBlock}
          insertActions={
            <ItemPickerDialog subjects={subjects} grades={grades} onInsert={handleInsertItems} />
          }
        />
      ) : (
        <div className="rounded-xl border border-border bg-card p-6 sm:p-10">
          <DocumentRenderer
            content={{ version: DOCUMENT_CONTENT_VERSION, blocks }}
            audience="teacher"
          />
        </div>
      )}

      <CustomizeItemDialog
        documentId={document.id}
        block={editingItemBlock}
        onClose={() => setEditingItemBlock(null)}
        onSaved={applyServerDocument}
      />
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'idle') return null;
  if (state === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Guardando…
      </span>
    );
  }
  if (state === 'saved') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-success">
        <Check className="size-3.5" aria-hidden />
        Guardado
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-destructive">
        <TriangleAlert className="size-3.5" aria-hidden />
        Error al guardar
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">Cambios sin guardar</span>;
}
