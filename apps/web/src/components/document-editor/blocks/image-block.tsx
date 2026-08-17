'use client';

import { useRef, useState } from 'react';
import { Image as ImageIcon, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { MAX_DOCUMENT_IMAGE_BYTES, type ImageBlock } from '@soe/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { BlockDefinition, BlockEditProps, BlockViewProps } from '../block-registry';

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

type ImageAlign = NonNullable<ImageBlock['align']>;

const ALIGN_CLASS: Record<ImageAlign, string> = {
  left: 'justify-start',
  center: 'justify-center',
  right: 'justify-end',
};

const ALIGN_LABELS: Record<ImageAlign, string> = {
  left: 'Izquierda',
  center: 'Centro',
  right: 'Derecha',
};

const ALIGNS: readonly ImageAlign[] = ['left', 'center', 'right'];

function parseAlign(value: string): ImageAlign {
  return value === 'left' ? 'left' : value === 'right' ? 'right' : 'center';
}

function ImageFigure({
  block,
  assets,
}: {
  block: ImageBlock;
  assets?: Record<string, string>;
}) {
  const url = assets?.[block.fileId];
  return (
    <div className={cn('flex', ALIGN_CLASS[block.align ?? 'center'])}>
      <figure className="max-w-full">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={block.caption ?? 'Imagen del documento'}
            className="max-h-96 max-w-full rounded-md border border-border object-contain"
          />
        ) : (
          <div className="flex h-36 w-64 max-w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-muted/30 text-sm text-muted-foreground">
            <ImageIcon className="size-5" aria-hidden />
            Imagen
          </div>
        )}
        {block.caption?.trim() ? (
          <figcaption className="mt-1.5 text-center text-xs text-muted-foreground">
            {block.caption}
          </figcaption>
        ) : null}
      </figure>
    </div>
  );
}

function ImageEditView({ block, onChange, assets, onUploadImage }: BlockEditProps<ImageBlock>) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const hasImage = Boolean(assets?.[block.fileId]);

  async function handleFileSelected(file: File) {
    if (!onUploadImage) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      toast.error('Formato no soportado. Usa PNG, JPG, WebP o SVG.');
      return;
    }
    if (file.size > MAX_DOCUMENT_IMAGE_BYTES) {
      toast.error('La imagen no puede superar los 5 MB.');
      return;
    }

    setIsUploading(true);
    try {
      const result = await onUploadImage(file);
      if (!result) return;
      onChange({ ...block, fileId: result.fileId });
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      <ImageFigure block={block} assets={assets} />
      {onUploadImage ? (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFileSelected(file);
              event.target.value = '';
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={Upload}
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {isUploading ? 'Subiendo…' : hasImage ? 'Cambiar imagen' : 'Subir imagen'}
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={block.caption ?? ''}
          placeholder="Leyenda (opcional)"
          aria-label="Leyenda de la imagen"
          className="min-w-48 flex-1"
          onChange={(event) =>
            onChange({ ...block, caption: event.target.value || undefined })
          }
        />
        <Select
          value={block.align ?? 'center'}
          onValueChange={(value) => onChange({ ...block, align: parseAlign(value) })}
        >
          <SelectTrigger className="w-32 shrink-0" aria-label="Alineación de la imagen">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ALIGNS.map((align) => (
              <SelectItem key={align} value={align}>
                {ALIGN_LABELS[align]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function ImagePrintView({ block, assets }: BlockViewProps<ImageBlock>) {
  return <ImageFigure block={block} assets={assets} />;
}

export const imageBlockDefinition: BlockDefinition<ImageBlock> = {
  label: 'Imagen',
  icon: ImageIcon,
  makeDefault: () => ({ id: crypto.randomUUID(), type: 'image', fileId: crypto.randomUUID() }),
  EditView: ImageEditView,
  PrintView: ImagePrintView,
};
