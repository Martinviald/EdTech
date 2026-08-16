'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Check, Eye, Loader2, Pencil, TriangleAlert } from 'lucide-react';
import {
  DOCUMENT_CONTENT_VERSION,
  type Block,
  type DocumentModel,
  type UpdateDocumentDto,
} from '@soe/types';
import { apiClientPatch } from '@/lib/api-client';
import { getDisplayMessage } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DocumentCanvas } from '@/components/document-editor/document-canvas';
import { DocumentRenderer } from '@/components/document-editor/document-renderer';
import { BLOCK_TYPE_ORDER } from '@/components/document-editor/block-registry';

const AUTOSAVE_DELAY_MS = 1500;

// Los bloques `item` referencian filas vivas de `items`; se insertan desde el
// picker del banco (otra fase), no fabricados en blanco desde el insertador.
const INSERTABLE_TYPES = BLOCK_TYPE_ORDER.filter((type) => type !== 'item');

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

type Mode = 'edit' | 'preview';

export function DocumentEditorShell({ document }: { document: DocumentModel }) {
  const [title, setTitle] = useState(document.title);
  const [blocks, setBlocks] = useState<Block[]>(document.content.blocks);
  const [mode, setMode] = useState<Mode>('edit');
  const [saveState, setSaveState] = useState<SaveState>('idle');

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
        <div className="ml-auto inline-flex items-center gap-0.5 rounded-lg border border-border p-0.5">
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

      {mode === 'edit' ? (
        <DocumentCanvas
          value={blocks}
          onChange={handleBlocksChange}
          insertableTypes={INSERTABLE_TYPES}
        />
      ) : (
        <div className="rounded-xl border border-border bg-card p-6 sm:p-10">
          <DocumentRenderer
            content={{ version: DOCUMENT_CONTENT_VERSION, blocks }}
            audience="teacher"
          />
        </div>
      )}
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
