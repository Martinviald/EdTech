'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import type { Route } from 'next';
import { createDocumentSchema, DOCUMENT_TYPES, type DocumentType } from '@soe/types';
import { ROUTES } from '@/lib/routes';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DOCUMENT_TYPE_LABELS } from './labels';
import { createDocument } from './actions';

const TYPE_DESCRIPTIONS: Record<DocumentType, string> = {
  guide: 'Material de apoyo con actividades, sin preguntas del banco.',
  worksheet: 'Guía con ejercicios: agrega preguntas desde el banco de contenido.',
  assessment: 'Versión imprimible de una prueba, con o sin pauta.',
  generic: 'Documento libre: parte de una hoja en blanco.',
};

export function NewDocumentDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<DocumentType>('guide');
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = createDocumentSchema.safeParse({ title: title.trim(), type });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Completa el título del material');
      return;
    }

    startTransition(async () => {
      const result = await createDocument(parsed.data);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setOpen(false);
      router.push(ROUTES.material(result.data.id) as Route);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 size-4" aria-hidden />
          Nuevo material
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nuevo material</DialogTitle>
            <DialogDescription>
              Crea un documento y ábrelo en el editor para armarlo por bloques.
            </DialogDescription>
          </DialogHeader>

          <Field label="Título" htmlFor="new-document-title" required>
            <Input
              id="new-document-title"
              value={title}
              maxLength={300}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej: Guía de fracciones — 5° básico"
              autoFocus
            />
          </Field>

          <Field label="Tipo de material" htmlFor="new-document-type" hint={TYPE_DESCRIPTIONS[type]}>
            <Select value={type} onValueChange={(v) => setType(v as DocumentType)}>
              <SelectTrigger id="new-document-type" aria-label="Tipo de material">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {DOCUMENT_TYPE_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Creando…' : 'Crear y abrir editor'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
