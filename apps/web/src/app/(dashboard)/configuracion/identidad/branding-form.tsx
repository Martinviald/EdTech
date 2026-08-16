'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { toast } from 'sonner';
import { ImageIcon, Trash2, Upload } from 'lucide-react';
import { updateOrgBrandingSchema, type OrgBrandingResponse } from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/shared';
import { confirmLogoUpload, requestLogoUploadUrl, saveBranding } from './actions';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ACCEPTED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

type BrandingFormProps = {
  initial: OrgBrandingResponse;
};

export function BrandingForm({ initial }: BrandingFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [logoFileId, setLogoFileId] = useState<string | null>(
    initial.branding.logoFileId ?? null,
  );
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(initial.logoUrl);
  const [displayName, setDisplayName] = useState(initial.branding.displayName ?? '');
  const [primaryColor, setPrimaryColor] = useState(initial.branding.primaryColor ?? '#1e3a8a');
  const [secondaryColor, setSecondaryColor] = useState(
    initial.branding.secondaryColor ?? '#64748b',
  );
  const [headerText, setHeaderText] = useState(initial.branding.headerText ?? '');
  const [footerText, setFooterText] = useState(initial.branding.footerText ?? '');

  async function handleLogoSelected(file: File) {
    if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
      toast.error('Formato no soportado. Usa PNG, JPG, SVG o WebP.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error('El logo no puede superar los 2 MB.');
      return;
    }

    setIsUploading(true);
    try {
      const urlResult = await requestLogoUploadUrl({
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        orgId: initial.orgId,
      });
      if (!urlResult.ok) {
        toast.error(urlResult.message);
        return;
      }

      const { uploadUrl, headers, fileId } = urlResult.data;
      const putResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers,
        body: file,
      });
      if (!putResponse.ok) {
        toast.error('No se pudo subir el archivo al almacenamiento.');
        return;
      }

      const confirmResult = await confirmLogoUpload(fileId, file.size);
      if (!confirmResult.ok) {
        toast.error(confirmResult.message);
        return;
      }

      setLogoFileId(fileId);
      setLogoPreviewUrl(confirmResult.data.downloadUrl ?? URL.createObjectURL(file));
      toast.success('Logo subido. Recuerda guardar los cambios.');
    } finally {
      setIsUploading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = updateOrgBrandingSchema.safeParse({
      logoFileId,
      displayName: displayName.trim() || undefined,
      primaryColor,
      secondaryColor,
      headerText: headerText.trim() || undefined,
      footerText: footerText.trim() || undefined,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Datos inválidos');
      return;
    }

    startTransition(async () => {
      const result = await saveBranding(parsed.data);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success('Identidad del colegio guardada.');
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Logo</CardTitle>
          <CardDescription>
            Aparece en la cabecera de los materiales impresos. PNG, JPG, SVG o WebP, máximo 2 MB.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <div className="border-border bg-muted/30 flex size-24 items-center justify-center overflow-hidden rounded-lg border">
            {logoPreviewUrl ? (
              <Image
                src={logoPreviewUrl}
                alt="Logo del colegio"
                width={96}
                height={96}
                unoptimized
                className="size-full object-contain"
              />
            ) : (
              <ImageIcon className="text-muted-foreground size-8" aria-hidden />
            )}
          </div>
          <div className="flex flex-col gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_LOGO_TYPES.join(',')}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleLogoSelected(file);
                e.target.value = '';
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-2 size-4" aria-hidden />
              {isUploading ? 'Subiendo…' : logoFileId ? 'Cambiar logo' : 'Subir logo'}
            </Button>
            {logoFileId ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={() => {
                  setLogoFileId(null);
                  setLogoPreviewUrl(null);
                }}
              >
                <Trash2 className="mr-2 size-4" aria-hidden />
                Quitar logo
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Identidad</CardTitle>
          <CardDescription>
            Nombre y colores institucionales que usan las cabeceras de tus documentos.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field
              label="Nombre a mostrar"
              htmlFor="branding-display-name"
              hint="Si lo dejas vacío se usa el nombre oficial del colegio."
            >
              <Input
                id="branding-display-name"
                value={displayName}
                maxLength={120}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Ej: Colegio San Martín de Porres"
              />
            </Field>
          </div>
          <ColorField
            id="branding-primary"
            label="Color principal"
            value={primaryColor}
            onChange={setPrimaryColor}
          />
          <ColorField
            id="branding-secondary"
            label="Color secundario"
            value={secondaryColor}
            onChange={setSecondaryColor}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Textos de impresión</CardTitle>
          <CardDescription>
            Se muestran en la cabecera y el pie de página de cada material exportado.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field label="Texto de cabecera" htmlFor="branding-header">
            <Input
              id="branding-header"
              value={headerText}
              maxLength={200}
              onChange={(e) => setHeaderText(e.target.value)}
              placeholder="Ej: Departamento de Lenguaje y Comunicación"
            />
          </Field>
          <Field label="Texto de pie de página" htmlFor="branding-footer">
            <Input
              id="branding-footer"
              value={footerText}
              maxLength={300}
              onChange={(e) => setFooterText(e.target.value)}
              placeholder="Ej: Av. Siempre Viva 123, Santiago · contacto@colegio.cl"
            />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={isPending || isUploading}>
          {isPending ? 'Guardando…' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  );
}

function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} (selector)`}
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="border-border size-9 cursor-pointer rounded-md border p-0.5"
        />
        <Input
          id={id}
          value={value}
          maxLength={7}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#1E3A8A"
          className="w-32 font-mono uppercase"
        />
      </div>
    </Field>
  );
}
