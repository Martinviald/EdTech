'use client';

import { useEffect, useState, useTransition, type JSX } from 'react';
import { Sparkles, Check, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ItemEditProposalModel, ItemEditProposalStatus } from '@soe/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { listItemEditProposals, proposeItemEdit, reviewItemEditProposal } from './proposal-actions';

// ─────────────────────────────────────────────────────────────────────────────
// TKT-19 — Escritura asistida de ítems (la IA propone, el humano aprueba).
// Sección del detalle del ítem: permite pedir a la IA una propuesta de edición y
// revisarla (diff contenido actual vs propuesto) para APROBAR (aplica el cambio
// al ítem) o RECHAZAR. La IA nunca modifica el ítem directamente (§8.3).
// ─────────────────────────────────────────────────────────────────────────────

const textareaClass =
  'flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const STATUS_META: Record<ItemEditProposalStatus, { label: string; className: string }> = {
  pending: {
    label: 'Pendiente',
    className: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200',
  },
  approved: {
    label: 'Aprobada',
    className: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200',
  },
  rejected: {
    label: 'Rechazada',
    className: 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300',
  },
};

type Content = Record<string, unknown> | null;
type Alt = { key: string; text?: string; isCorrect?: boolean };

function getStem(content: Content): string | null {
  if (!content) return null;
  for (const f of ['stem', 'text', 'prompt', 'question', 'passage', 'textWithGaps'] as const) {
    if (typeof content[f] === 'string' && content[f]) return content[f] as string;
  }
  return null;
}

function getAlternatives(content: Content): Alt[] {
  const raw = content?.alternatives;
  if (!Array.isArray(raw)) return [];
  return raw.filter((a): a is Alt => typeof a === 'object' && a !== null && 'key' in a);
}

export function ItemEditProposals({
  itemId,
  instrumentId,
  canEdit,
}: {
  itemId: string;
  instrumentId: string;
  canEdit: boolean;
}): JSX.Element {
  const [proposals, setProposals] = useState<ItemEditProposalModel[]>([]);
  const [instruction, setInstruction] = useState('');
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  // Carga inicial de las propuestas del ítem.
  useEffect(() => {
    let active = true;
    setLoading(true);
    listItemEditProposals(itemId).then((res) => {
      if (!active) return;
      if (res.ok) setProposals(res.data);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [itemId]);

  function handlePropose() {
    const text = instruction.trim();
    if (text.length < 3) {
      toast.error('Describe qué cambiar (al menos 3 caracteres).');
      return;
    }
    startTransition(async () => {
      const res = await proposeItemEdit(itemId, text);
      if (res.ok) {
        setProposals((prev) => [res.data, ...prev]);
        setInstruction('');
        toast.success('Propuesta creada. Revísala y apruébala o recházala.');
      } else {
        toast.error(res.message);
      }
    });
  }

  function handleReview(proposalId: string, action: 'approve' | 'reject') {
    setBusyId(proposalId);
    startTransition(async () => {
      const res = await reviewItemEditProposal(instrumentId, proposalId, action);
      if (res.ok) {
        setProposals((prev) => prev.map((p) => (p.id === proposalId ? res.data : p)));
        toast.success(
          action === 'approve' ? 'Propuesta aprobada y aplicada al ítem.' : 'Propuesta rechazada.',
        );
      } else {
        toast.error(res.message);
      }
      setBusyId(null);
    });
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-primary" aria-hidden />
        <h3 className="text-sm font-semibold text-foreground">Edición asistida por IA</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        La IA propone un cambio al contenido de la pregunta; un editor lo aprueba o rechaza. Nunca
        se modifica el ítem sin aprobación.
      </p>

      {canEdit ? (
        <div className="space-y-2 rounded-md border bg-muted/20 p-3">
          <label htmlFor={`instr-${itemId}`} className="text-xs font-medium text-foreground">
            ¿Qué quieres mejorar o corregir?
          </label>
          <textarea
            id={`instr-${itemId}`}
            className={textareaClass}
            placeholder="Ej: mejora la redacción del enunciado; la clave correcta debería ser B…"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            disabled={isPending}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={handlePropose} disabled={isPending}>
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="size-4" aria-hidden />
              )}
              Proponer edición con IA
            </Button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando propuestas…</p>
      ) : proposals.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Esta pregunta no tiene propuestas de edición.
        </p>
      ) : (
        <ul className="space-y-3">
          {proposals.map((p) => (
            <ProposalCard
              key={p.id}
              proposal={p}
              canEdit={canEdit}
              busy={busyId === p.id && isPending}
              onReview={handleReview}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProposalCard({
  proposal,
  canEdit,
  busy,
  onReview,
}: {
  proposal: ItemEditProposalModel;
  canEdit: boolean;
  busy: boolean;
  onReview: (id: string, action: 'approve' | 'reject') => void;
}): JSX.Element {
  const meta = STATUS_META[proposal.status];
  const current = proposal.currentContent as Content;
  const proposed = proposal.proposedContent as Content;

  return (
    <li className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn('border-0 text-[10px]', meta.className)}>
            {meta.label}
          </Badge>
          {proposal.author === 'ai' ? (
            <Badge variant="secondary" className="gap-0.5 px-1 py-0 text-[10px] font-normal">
              <Sparkles className="size-2.5" aria-hidden />
              IA
            </Badge>
          ) : null}
          {proposal.appliedVersion !== null ? (
            <span className="text-[10px] text-muted-foreground">v{proposal.appliedVersion}</span>
          ) : null}
        </div>
        <time className="text-[10px] text-muted-foreground">
          {new Date(proposal.createdAt).toLocaleString('es-CL')}
        </time>
      </div>

      {proposal.instruction ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Instrucción:</span> {proposal.instruction}
        </p>
      ) : null}
      {proposal.reasoning ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Razonamiento IA:</span> {proposal.reasoning}
        </p>
      ) : null}

      {/* Diff: actual vs propuesto */}
      <div className="grid gap-3 sm:grid-cols-2">
        <ContentColumn title="Actual" content={current} tone="current" />
        <ContentColumn title="Propuesto" content={proposed} tone="proposed" />
      </div>

      {canEdit && proposal.status === 'pending' ? (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onReview(proposal.id, 'reject')}
            disabled={busy}
          >
            <X className="size-4" aria-hidden />
            Rechazar
          </Button>
          <Button size="sm" onClick={() => onReview(proposal.id, 'approve')} disabled={busy}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Check className="size-4" aria-hidden />
            )}
            Aprobar y aplicar
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function ContentColumn({
  title,
  content,
  tone,
}: {
  title: string;
  content: Content;
  tone: 'current' | 'proposed';
}): JSX.Element {
  const stem = getStem(content);
  const alternatives = getAlternatives(content);
  return (
    <div
      className={cn(
        'space-y-2 rounded-md border p-2.5 text-xs',
        tone === 'proposed' ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/20',
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <p className="whitespace-pre-line text-foreground">{stem ?? '(sin enunciado)'}</p>
      {alternatives.length > 0 ? (
        <ul className="space-y-1">
          {alternatives.map((alt) => (
            <li
              key={alt.key}
              className={cn(
                'flex items-start gap-1.5',
                alt.isCorrect ? 'font-medium text-emerald-700 dark:text-emerald-300' : '',
              )}
            >
              <span className="tabular-nums">{alt.key}.</span>
              <span className="min-w-0 flex-1">{alt.text ?? ''}</span>
              {alt.isCorrect ? <Check className="mt-0.5 size-3 shrink-0" aria-hidden /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
