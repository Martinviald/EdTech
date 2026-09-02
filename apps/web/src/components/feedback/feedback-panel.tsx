'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertCircle, HelpCircle, ImagePlus, Lightbulb, Loader2, X } from 'lucide-react';
import { FEEDBACK_TYPE_LABELS, type FeedbackType } from '@soe/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { submitFeedback, uploadFeedbackScreenshot } from './feedback-api';
import { useFeedbackContext } from './use-feedback-context';

const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MIME = ['image/png', 'image/jpeg', 'image/webp'];

const TYPE_OPTIONS: Array<{ value: FeedbackType; icon: typeof AlertCircle }> = [
  { value: 'bug', icon: AlertCircle },
  { value: 'idea', icon: Lightbulb },
  { value: 'confusion', icon: HelpCircle },
];

/**
 * Panel del widget de comentarios. Tres decisiones deliberadas de diseño:
 *
 *  1. Un solo campo obligatorio (el texto). El tipo viene preseleccionado y la
 *     captura es opcional. Cada campo obligatorio de más es feedback que no se
 *     escribe.
 *  2. El contexto (ruta, rol, navegador) se adjunta solo — la persona no lo ve
 *     como trabajo suyo, pero es lo que hace accionable el comentario.
 *  3. Si la captura falla al subir, el comentario se envía igual. Nunca se
 *     pierde el texto por un problema de S3.
 */
export function FeedbackPanel({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [type, setType] = useState<FeedbackType>('bug');
  const [message, setMessage] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const buildContext = useFeedbackContext();

  const reset = () => {
    setType('bug');
    setMessage('');
    setScreenshot(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFile = (file: File | null) => {
    if (!file) {
      setScreenshot(null);
      return;
    }
    if (!ACCEPTED_MIME.includes(file.type)) {
      toast.error('La captura debe ser una imagen PNG, JPG o WebP.');
      return;
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      toast.error('La captura no puede superar los 10 MB.');
      return;
    }
    setScreenshot(file);
  };

  const handleSubmit = async () => {
    const text = message.trim();
    if (!text) {
      toast.error('Escribe tu comentario antes de enviarlo.');
      return;
    }

    setSending(true);
    try {
      const screenshotFileId = screenshot ? await uploadFeedbackScreenshot(screenshot) : null;
      if (screenshot && !screenshotFileId) {
        toast.warning('No se pudo adjuntar la captura, pero enviamos tu comentario.');
      }

      await submitFeedback({
        type,
        message: text,
        context: buildContext(),
        screenshotFileId,
      });

      toast.success('¡Gracias! Recibimos tu comentario.');
      reset();
      onOpenChange(false);
    } catch {
      toast.error('No pudimos enviar tu comentario. Vuelve a intentar en unos segundos.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-6 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Enviar un comentario</SheetTitle>
          <SheetDescription>
            Cuéntanos qué te pasó en esta pantalla. Adjuntamos automáticamente dónde estabas para
            poder revisarlo.
          </SheetDescription>
        </SheetHeader>

        <fieldset className="space-y-2" disabled={sending}>
          <legend className="mb-2 text-sm font-medium">¿Qué quieres contarnos?</legend>
          <div className="grid gap-2">
            {TYPE_OPTIONS.map(({ value, icon: Icon }) => (
              <button
                key={value}
                type="button"
                aria-pressed={type === value}
                onClick={() => setType(value)}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-3 text-left text-sm transition',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  type === value
                    ? 'border-primary bg-primary/5 font-medium text-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted/50',
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {FEEDBACK_TYPE_LABELS[value]}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-1 flex-col gap-2">
          <label htmlFor="feedback-message" className="text-sm font-medium">
            Cuéntanos qué pasó
          </label>
          <Textarea
            id="feedback-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={5000}
            disabled={sending}
            placeholder="Escribe con tus palabras. No hace falta que sea formal."
            className="min-h-32 flex-1 resize-none"
          />
        </div>

        <div className="space-y-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_MIME.join(',')}
            className="sr-only"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
          {screenshot ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm">
              <span className="truncate text-muted-foreground">{screenshot.name}</span>
              <button
                type="button"
                onClick={() => handleFile(null)}
                aria-label="Quitar la captura"
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={sending}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="mr-2 size-4" aria-hidden />
              Adjuntar una captura (opcional)
            </Button>
          )}
        </div>

        <Button type="button" onClick={handleSubmit} disabled={sending || !message.trim()}>
          {sending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
          {sending ? 'Enviando…' : 'Enviar comentario'}
        </Button>
      </SheetContent>
    </Sheet>
  );
}
