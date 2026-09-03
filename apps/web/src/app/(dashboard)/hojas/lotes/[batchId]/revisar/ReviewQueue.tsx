'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  FileQuestion,
  ImageOff,
  Loader2,
  ScanLine,
  Trash2,
  UserRoundSearch,
} from 'lucide-react';
import { discardScanSchema, type ConfirmBatchResponse, type ReviewScanModel } from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCallout, EmptyState } from '@/components/shared';
import {
  useAssignIdentity,
  useConfirmBatch,
  useDiscardScan,
} from '../../../hooks/use-review-queue';
import type { StudentOption } from './ReviewShell';
import { REJECT_REASON_LABELS } from './review-labels';

/** Una hoja sin ninguna marca detectada: el alumno probablemente no respondió. */
export function isLikelyBlankScan(scan: ReviewScanModel): boolean {
  return scan.marksReadability === 'likely_blank';
}

export function PagesReviewStep({
  batchId,
  qualityRejected,
  identityUnresolved,
  students,
  rosterAvailable,
}: {
  batchId: string;
  qualityRejected: ReviewScanModel[];
  identityUnresolved: ReviewScanModel[];
  students: StudentOption[];
  rosterAvailable: boolean;
}) {
  const blankSheets = qualityRejected.filter(isLikelyBlankScan);
  const unreadablePages = qualityRejected.filter((scan) => !isLikelyBlankScan(scan));
  const nothingToReview = qualityRejected.length === 0 && identityUnresolved.length === 0;

  if (nothingToReview) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="No hay páginas por revisar"
        description="El lector leyó todas las hojas del lote y reconoció a quién pertenece cada una. Continúa con las marcas dudosas."
      />
    );
  }

  return (
    <div className="space-y-6">
      {blankSheets.length > 0 && <BlankSheetsSection batchId={batchId} scans={blankSheets} />}
      {unreadablePages.length > 0 && (
        <UnreadablePagesSection batchId={batchId} scans={unreadablePages} />
      )}
      {identityUnresolved.length > 0 && (
        <IdentitySection
          batchId={batchId}
          scans={identityUnresolved}
          students={students}
          rosterAvailable={rosterAvailable}
        />
      )}
    </div>
  );
}

function ScanThumb({ scan }: { scan: ReviewScanModel }) {
  if (!scan.thumbUrl) {
    return (
      <div className="flex h-24 w-20 shrink-0 items-center justify-center rounded-md border bg-muted">
        <ImageOff className="size-5 text-muted-foreground" aria-hidden />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={scan.thumbUrl}
      alt={`Miniatura de la página ${scan.pageIndex + 1}`}
      className="h-24 w-20 shrink-0 rounded-md border bg-card object-cover"
    />
  );
}

function scanOriginLabel(scan: ReviewScanModel): string {
  const parts = [`Página ${scan.pageIndex + 1}`];
  if (scan.sheetSequence !== null) parts.unshift(`Hoja Nº ${scan.sheetSequence}`);
  return parts.join(' · ');
}

function ScanRow({
  batchId,
  scan,
  title,
}: {
  batchId: string;
  scan: ReviewScanModel;
  title: string;
}) {
  return (
    <li className="flex flex-wrap items-center gap-4 py-3">
      <ScanThumb scan={scan} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">
          {scanOriginLabel(scan)}
          {scan.studentName ? ` · ${scan.studentName}` : ''}
        </p>
      </div>
      <DiscardScanDialog batchId={batchId} scan={scan} />
    </li>
  );
}

function BlankSheetsSection({ batchId, scans }: { batchId: string; scans: ReviewScanModel[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileQuestion className="size-4 text-muted-foreground" aria-hidden />
          Hojas sin respuestas <span className="text-muted-foreground">({scans.length})</span>
        </CardTitle>
        <CardDescription>
          El lector no encontró ninguna marca en estas hojas: parece que el alumno no respondió, no
          que la lectura haya fallado. Mira la miniatura y decide: si la hoja está efectivamente en
          blanco, déjala así y continúa (queda registrada como no respondida). Si alcanzas a ver
          marcas en la foto, entonces la lectura sí falló: vuelve a fotografiarla con luz pareja y
          súbela en un lote nuevo.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {scans.map((scan) => (
            <ScanRow
              key={scan.scanId}
              batchId={batchId}
              scan={scan}
              title="Hoja sin marcas detectadas"
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function UnreadablePagesSection({ batchId, scans }: { batchId: string; scans: ReviewScanModel[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ScanLine className="size-4 text-muted-foreground" aria-hidden />
          Páginas que no se pudieron leer{' '}
          <span className="text-muted-foreground">({scans.length})</span>
        </CardTitle>
        <CardDescription>
          La foto no permitió distinguir las marcas con seguridad. Repite la captura con luz pareja
          y sin sombra sobre la hoja, y súbela en un lote nuevo; o descarta la página si no
          corresponde a este curso.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {scans.map((scan) => (
            <ScanRow
              key={scan.scanId}
              batchId={batchId}
              scan={scan}
              title={
                scan.rejectReason
                  ? REJECT_REASON_LABELS[scan.rejectReason]
                  : 'Página rechazada por calidad'
              }
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function DiscardScanDialog({ batchId, scan }: { batchId: string; scan: ReviewScanModel }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const discard = useDiscardScan(batchId);

  function handleDiscard() {
    const parsed = discardScanSchema.safeParse({ reason: reason.trim() });
    if (!parsed.success) {
      toast.error('Escribe el motivo del descarte.');
      return;
    }
    discard.mutate(
      { scanId: scan.scanId, reason: parsed.data.reason },
      {
        onSuccess: () => {
          setOpen(false);
          setReason('');
          toast.success('Página descartada del lote.');
        },
      },
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Trash2 className="mr-2 size-4" aria-hidden />
          Descartar
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Descartar esta página del lote</AlertDialogTitle>
          <AlertDialogDescription>
            La página queda fuera del lote y no genera respuestas. Indica el motivo: queda
            registrado con tu nombre.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ej.: hoja de otro curso, se volverá a escanear, página duplicada…"
          maxLength={500}
          aria-label="Motivo del descarte"
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={discard.isPending}>Cancelar</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleDiscard}
            disabled={discard.isPending || reason.trim().length === 0}
          >
            {discard.isPending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
            Descartar página
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function IdentitySection({
  batchId,
  scans,
  students,
  rosterAvailable,
}: {
  batchId: string;
  scans: ReviewScanModel[];
  students: StudentOption[];
  rosterAvailable: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserRoundSearch className="size-4 text-muted-foreground" aria-hidden />
          Identidades sin resolver <span className="text-muted-foreground">({scans.length})</span>
        </CardTitle>
        <CardDescription>
          El QR no alcanzó para saber de quién es la hoja (o es una hoja de reserva). Asigna el
          alumno mirando la miniatura.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!rosterAvailable && (
          <AlertCallout tone="warning" title="No se pudo cargar la nómina del curso">
            Sin la nómina no es posible asignar identidades desde acá. Verifica que la tirada tenga
            un curso asociado.
          </AlertCallout>
        )}
        <ul className="divide-y">
          {scans.map((scan) => (
            <IdentityRow
              key={scan.scanId}
              batchId={batchId}
              scan={scan}
              students={students}
              rosterAvailable={rosterAvailable}
            />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function IdentityRow({
  batchId,
  scan,
  students,
  rosterAvailable,
}: {
  batchId: string;
  scan: ReviewScanModel;
  students: StudentOption[];
  rosterAvailable: boolean;
}) {
  const [studentId, setStudentId] = useState('');
  const assign = useAssignIdentity(batchId);

  function handleAssign() {
    if (!studentId) return;
    assign.mutate(
      { scanId: scan.scanId, studentId },
      { onSuccess: () => toast.success('Identidad asignada.') },
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-4 py-3">
      <ScanThumb scan={scan} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          {scan.studentName ?? 'Hoja sin alumno asignado'}
        </p>
        <p className="text-xs text-muted-foreground">
          {scanOriginLabel(scan)}
          {scan.identityConfidence !== null
            ? ` · confianza ${Math.round(scan.identityConfidence * 100)} %`
            : ''}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Select value={studentId} onValueChange={setStudentId} disabled={!rosterAvailable}>
          <SelectTrigger
            className="w-56"
            aria-label={`Alumno para la página ${scan.pageIndex + 1}`}
          >
            <SelectValue placeholder="Selecciona al alumno" />
          </SelectTrigger>
          <SelectContent>
            {students.map((student) => (
              <SelectItem key={student.studentId} value={student.studentId}>
                {student.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={handleAssign}
          disabled={!studentId || assign.isPending || !rosterAvailable}
        >
          {assign.isPending ? (
            <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
          ) : (
            <UserRoundSearch className="mr-2 size-4" aria-hidden />
          )}
          Asignar
        </Button>
      </div>
    </li>
  );
}

export function ConfirmBatchDialog({
  batchId,
  pendingMarks,
  pendingIdentities,
  blankSheets,
  unreadablePages,
  disabled,
  onConfirmed,
}: {
  batchId: string;
  pendingMarks: number;
  pendingIdentities: number;
  blankSheets: number;
  unreadablePages: number;
  disabled?: boolean;
  onConfirmed: (result: ConfirmBatchResponse) => void;
}) {
  const [open, setOpen] = useState(false);
  const confirm = useConfirmBatch(batchId);
  const totalPending = pendingMarks + pendingIdentities;

  function handleConfirm() {
    confirm.mutate(undefined, {
      onSuccess: (result) => {
        setOpen(false);
        onConfirmed(result);
      },
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button disabled={disabled}>
          <CheckCircle2 className="mr-2 size-4" aria-hidden />
          Finalizar corrección
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Finalizar la corrección y persistir los resultados</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>Al finalizar, las lecturas se convierten en respuestas definitivas.</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  {pendingMarks === 0
                    ? 'No quedan marcas dudosas sin resolver.'
                    : `${pendingMarks} ${pendingMarks === 1 ? 'marca dudosa' : 'marcas dudosas'} sin resolver.`}
                </li>
                <li>
                  {pendingIdentities === 0
                    ? 'No quedan hojas sin identidad.'
                    : `${pendingIdentities} ${pendingIdentities === 1 ? 'hoja' : 'hojas'} sin identidad (no generarán respuestas).`}
                </li>
                <li>
                  {blankSheets === 0
                    ? 'No hay hojas sin respuestas.'
                    : `${blankSheets} ${blankSheets === 1 ? 'hoja parece' : 'hojas parecen'} sin responder y quedarán como no escaneadas.`}
                </li>
                <li>
                  {unreadablePages === 0
                    ? 'No quedan páginas ilegibles.'
                    : `${unreadablePages} ${unreadablePages === 1 ? 'página' : 'páginas'} que no se pudieron leer quedarán como no escaneadas.`}
                </li>
              </ul>
              {totalPending > 0 && (
                <p className="font-medium text-foreground">
                  Los pendientes quedan registrados como una decisión tuya, con tu nombre. Puedes
                  resolverlos ahora o asumirlos.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={confirm.isPending}>Seguir revisando</AlertDialogCancel>
          <Button onClick={handleConfirm} disabled={confirm.isPending}>
            {confirm.isPending && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />}
            Finalizar corrección
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
