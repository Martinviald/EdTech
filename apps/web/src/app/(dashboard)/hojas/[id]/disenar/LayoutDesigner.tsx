'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Lock } from 'lucide-react';
import type { LayoutDraftModel, LayoutSpec } from '@soe/types';
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
import { Button } from '@/components/ui/button';
import { AlertCallout, StatCard } from '@/components/shared';
import { SheetPreview } from '../../components/SheetPreview';
import { HOJAS_ROUTES } from '../../lib/routes';
import { freezeLayout } from '../../actions';

const PAPER_LABELS: Record<LayoutSpec['paper'], string> = {
  letter: 'Carta',
  a4: 'A4',
  legal: 'Oficio',
};

function buildFieldsHint(fields: LayoutSpec['fields']): string {
  let bubbleGroups = 0;
  let digitGrids = 0;
  let cropRegions = 0;
  for (const field of fields) {
    if (field.kind === 'digit_grid') digitGrids += 1;
    else if (field.kind === 'crop_region') cropRegions += 1;
    else bubbleGroups += 1;
  }
  if (digitGrids === 0 && cropRegions === 0) return 'Una fila de burbujas por pregunta';

  const parts: string[] = [];
  if (bubbleGroups > 0) parts.push(`${bubbleGroups} de alternativas`);
  if (digitGrids > 0) parts.push(`${digitGrids} en grilla de dígitos`);
  if (cropRegions > 0) parts.push(`${cropRegions} de respuesta escrita`);
  return parts.join(' · ');
}

export function LayoutDesigner({
  draft,
  instrumentName,
}: {
  draft: LayoutDraftModel;
  instrumentName: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { spec, excludedItems } = draft;

  function handleFreeze() {
    startTransition(async () => {
      const result = await freezeLayout(spec);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(
        `Layout congelado (v${result.data.version}). Hash ${result.data.specHash} — viaja en el QR de cada hoja.`,
      );
      router.push(HOJAS_ROUTES.imprimir(result.data.layoutId));
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Instrumento"
          value={instrumentName ?? 'Sin nombre'}
          hint="Origen de las preguntas de la hoja"
        />
        <StatCard label="Páginas" value={String(spec.pageCount)} hint={`Papel ${PAPER_LABELS[spec.paper]}`} />
        <StatCard label="Campos en la hoja" value={String(spec.fields.length)} hint={buildFieldsHint(spec.fields)} />
        <StatCard
          label="Ítems excluidos"
          value={String(excludedItems.length)}
          hint={excludedItems.length > 0 ? 'Revisa el detalle más abajo' : 'Todos los ítems entraron'}
        />
      </div>

      {spec.identity.mode === 'rut_bubbles' ? (
        <AlertCallout tone="info" title="Hoja genérica con RUT">
          Todas las hojas de la tirada serán idénticas: cada alumno escribe su nombre y marca su
          RUT en la grilla de burbujas. Al leer, se valida el dígito verificador y se calza el RUT
          exacto contra la nómina del curso; una hoja sin calce va a revisión manual.
        </AlertCallout>
      ) : null}

      {excludedItems.length > 0 ? (
        <AlertCallout
          tone="warning"
          title={`${excludedItems.length} ${excludedItems.length === 1 ? 'ítem quedó fuera' : 'ítems quedaron fuera'} de la hoja`}
        >
          <p className="mb-2">
            Estas preguntas no se pueden leer con burbujas y deberán corregirse por otra vía:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {excludedItems.map((item) => (
              <li key={item.itemId}>
                <span className="font-medium">Pregunta {item.printedNumber}</span> — {item.reason}
              </li>
            ))}
          </ul>
        </AlertCallout>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">Vista previa de la hoja</h2>
        <p className="text-sm text-muted-foreground">
          {spec.identity.mode === 'rut_bubbles'
            ? 'Dibujada desde el mismo spec que usará la impresión y la lectura: fiduciales de esquina, grilla RUT con QR de la tirada en la esquina y cada pregunta con sus alternativas.'
            : 'Dibujada desde el mismo spec que usará la impresión y la lectura: fiduciales de esquina, región de identidad con QR y cada pregunta con sus alternativas.'}
        </p>
        <SheetPreview spec={spec} />
      </section>

      <div className="flex justify-end">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Congelando…
                </>
              ) : (
                <>
                  <Lock className="mr-2 size-4" />
                  Congelar layout
                </>
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Congelar este layout?</AlertDialogTitle>
              <AlertDialogDescription>
                Congelar es irreversible: el layout queda inmutable y su hash viaja impreso en el
                QR de cada hoja. Si después cambias el instrumento, deberás congelar una versión
                nueva y reimprimir — las hojas ya impresas con este hash dejarán de calzar.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleFreeze} disabled={pending}>
                Congelar layout
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
