'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Copy, FileText, MoreVertical, Trash2 } from 'lucide-react';
import type { Route } from 'next';
import type { DocumentListItem } from '@soe/types';
import { ROUTES } from '@/lib/routes';
import { StatusBadge } from '@/components/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_STATUS_TONES,
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_VISIBILITY_LABELS,
} from './labels';
import { deleteDocument, duplicateDocument } from './actions';

type DocumentRowProps = {
  document: DocumentListItem;
  currentUserId: string;
  catalogNames: Record<string, string>;
};

export function DocumentRow({ document, currentUserId, catalogNames }: DocumentRowProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isOwner = document.createdById === currentUserId;

  const metaParts = [
    document.subjectId ? catalogNames[document.subjectId] : null,
    document.gradeId ? catalogNames[document.gradeId] : null,
    document.itemCount > 0 ? `${document.itemCount} ítems` : null,
    document.createdByName,
  ].filter(Boolean);

  function handleDuplicate() {
    startTransition(async () => {
      const result = await duplicateDocument(document.id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success('Material duplicado. Ya puedes editar tu copia.');
      router.push(ROUTES.material(result.data.id) as Route);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteDocument(document.id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success('Material eliminado.');
      router.refresh();
    });
  }

  return (
    <div className="hover:bg-muted/50 flex items-center gap-4 px-4 py-3">
      <FileText className="text-muted-foreground size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <Link
          href={ROUTES.material(document.id) as Route}
          className="font-medium hover:underline"
        >
          {document.title}
        </Link>
        <p className="text-muted-foreground truncate text-sm">
          {metaParts.join(' · ') || 'Sin detalles'}
        </p>
      </div>
      <div className="hidden shrink-0 items-center gap-2 sm:flex">
        <Badge variant="outline">{DOCUMENT_TYPE_LABELS[document.type]}</Badge>
        <StatusBadge tone={DOCUMENT_STATUS_TONES[document.status]}>
          {DOCUMENT_STATUS_LABELS[document.status]}
        </StatusBadge>
        <Badge variant="secondary">{DOCUMENT_VISIBILITY_LABELS[document.visibility]}</Badge>
      </div>
      <AlertDialog>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" disabled={isPending} aria-label="Acciones">
              <MoreVertical className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={handleDuplicate}>
              <Copy className="mr-2 size-4" aria-hidden />
              {isOwner ? 'Duplicar' : 'Duplicar para editar'}
            </DropdownMenuItem>
            {isOwner ? (
              <AlertDialogTrigger asChild>
                <DropdownMenuItem className="text-destructive">
                  <Trash2 className="mr-2 size-4" aria-hidden />
                  Eliminar
                </DropdownMenuItem>
              </AlertDialogTrigger>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este material?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{document.title}&rdquo; dejará de estar disponible para ti y para quienes
              lo compartías. Esta acción no se puede deshacer desde la aplicación.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
