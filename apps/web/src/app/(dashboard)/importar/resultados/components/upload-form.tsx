'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { AlertCircle, Loader2, Upload } from 'lucide-react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { toast } from 'sonner';
import { ANSWER_SHEET_FORMATS, type AnswerSheetFormat } from '@soe/types';
import type { AnswerSheetColumnMapping, InstrumentModel } from '@soe/types';
import { parseCsvHeaders } from '@/lib/csv-parser';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ROUTES } from '@/lib/routes';
import { uploadAnswerSheetAction } from '../actions';

const MAX_BYTES = 10 * 1024 * 1024;

const FORMAT_LABELS: Record<AnswerSheetFormat, string> = {
  gradecam_csv: 'Gradecam (CSV)',
  zipgrade_csv: 'ZipGrade (CSV)',
  dia_official: 'DIA oficial (Agencia de Calidad)',
  generic_csv: 'CSV genérico',
};

// Valor centinela para la opción "ninguna columna" en los selects opcionales:
// shadcn/Radix Select no admite un SelectItem con value="".
const NONE = '__none__';

// Una columna parece "de pregunta" si es dígitos opcionalmente precedidos por
// letras/espacios: "p1", "Q01", "Item 3", "1". Se usa solo para autodetección.
const QUESTION_COLUMN_RE = /^[A-Za-z]* *0*\d+$/;

type GuessedMapping = {
  rut: string | null;
  firstName: string | null;
  lastName: string | null;
  questionColumns: string[];
};

function guessMapping(columns: string[]): GuessedMapping {
  const find = (re: RegExp) => columns.find((c) => re.test(c)) ?? null;
  const rut = find(/^(rut|run|student\s*id|id)$/i) ?? find(/rut|run/i);
  const firstName = find(/nombre|first\s*name/i);
  const lastName = find(/apellido|last\s*name/i);
  const used = new Set([rut, firstName, lastName].filter(Boolean));
  const questionColumns = columns.filter((c) => !used.has(c) && QUESTION_COLUMN_RE.test(c.trim()));
  return { rut, firstName, lastName, questionColumns };
}

interface UploadFormProps {
  defaultFormat: AnswerSheetFormat | null;
  instruments: InstrumentModel[];
}

export function UploadForm({ defaultFormat, instruments }: UploadFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [format, setFormat] = useState<AnswerSheetFormat>(defaultFormat ?? 'generic_csv');
  const [instrumentId, setInstrumentId] = useState<string>('');
  const [assessmentName, setAssessmentName] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Mapeo de columnas (solo formato generic_csv).
  const [detectedColumns, setDetectedColumns] = useState<string[]>([]);
  const [rutCol, setRutCol] = useState<string>('');
  const [firstNameCol, setFirstNameCol] = useState<string>('');
  const [lastNameCol, setLastNameCol] = useState<string>('');
  const [questionCols, setQuestionCols] = useState<string[]>([]);
  const [parsingHeaders, setParsingHeaders] = useState(false);

  const needsMapping = format === 'generic_csv';

  // Cuando hay archivo y el formato es genérico, leemos el encabezado en el
  // cliente y proponemos un mapeo inicial. Si no es genérico, limpiamos.
  useEffect(() => {
    if (!file || !needsMapping) {
      setDetectedColumns([]);
      setRutCol('');
      setFirstNameCol('');
      setLastNameCol('');
      setQuestionCols([]);
      return;
    }
    let cancelled = false;
    setParsingHeaders(true);
    parseCsvHeaders(file)
      .then((columns) => {
        if (cancelled) return;
        setDetectedColumns(columns);
        const guess = guessMapping(columns);
        setRutCol(guess.rut ?? '');
        setFirstNameCol(guess.firstName ?? '');
        setLastNameCol(guess.lastName ?? '');
        setQuestionCols(guess.questionColumns);
      })
      .catch(() => {
        if (cancelled) return;
        setDetectedColumns([]);
        toast.error('No se pudo leer el encabezado del CSV.');
      })
      .finally(() => {
        if (!cancelled) setParsingHeaders(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file, needsMapping]);

  const toggleQuestionCol = (col: string) => {
    setQuestionCols((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col],
    );
  };

  const onDrop = useCallback((accepted: File[], rejections: FileRejection[]) => {
    if (rejections.length > 0) {
      const r = rejections[0];
      const msg =
        r?.errors[0]?.message ?? 'Archivo rechazado. Verifica que sea un CSV válido menor a 10 MB.';
      toast.error(msg);
      return;
    }
    const first = accepted[0];
    if (first) {
      setFile(first);
      setErrorMessage(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'text/plain': ['.csv'],
      'application/vnd.ms-excel': ['.csv'],
    },
    maxFiles: 1,
    maxSize: MAX_BYTES,
    disabled: isPending,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!file) {
      setErrorMessage('Selecciona un archivo antes de continuar.');
      return;
    }
    if (!instrumentId) {
      setErrorMessage('Selecciona el instrumento DIA correspondiente.');
      return;
    }

    let columnMapping: AnswerSheetColumnMapping | null = null;
    if (needsMapping) {
      if (!rutCol) {
        setErrorMessage('Indica qué columna contiene el RUT del alumno.');
        return;
      }
      if (questionCols.length === 0) {
        setErrorMessage('Selecciona al menos una columna de pregunta.');
        return;
      }
      columnMapping = {
        rut: rutCol,
        ...(firstNameCol ? { firstName: firstNameCol } : {}),
        ...(lastNameCol ? { lastName: lastNameCol } : {}),
        questionColumns: questionCols,
      };
    }

    const fd = new FormData();
    fd.append('file', file);
    fd.append('format', format);
    fd.append('instrumentId', instrumentId);
    if (assessmentName.trim()) {
      fd.append('assessmentName', assessmentName.trim());
    }
    if (columnMapping) {
      fd.append('columnMapping', JSON.stringify(columnMapping));
    }

    startTransition(async () => {
      const result = await uploadAnswerSheetAction(fd);
      if (!result.ok) {
        setErrorMessage(result.message);
        toast.error(result.message);
        return;
      }
      toast.success('Archivo procesado. Revisa la previsualización.');
      router.push(
        `${ROUTES.importarResultadosPreview}?token=${encodeURIComponent(result.data.previewToken)}` as Route,
      );
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Archivo de respuestas</CardTitle>
        </CardHeader>
        <CardContent>
          {file ? (
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-muted-foreground text-xs">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFile(null)}
                disabled={isPending}
              >
                Cambiar
              </Button>
            </div>
          ) : (
            <div
              {...getRootProps()}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors sm:p-10',
                isDragActive
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/25 hover:bg-muted/50',
                isPending && 'pointer-events-none opacity-50',
              )}
            >
              <input {...getInputProps()} />
              <Upload className="text-muted-foreground h-10 w-10" />
              <div className="space-y-1">
                <p className="font-medium">
                  {isDragActive
                    ? 'Suelta el archivo aquí'
                    : 'Arrastra tu archivo o haz clic para seleccionar'}
                </p>
                <p className="text-muted-foreground text-xs">CSV con encabezado · máximo 10 MB</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Configuración</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="format">Formato del archivo</Label>
              <Select
                value={format}
                onValueChange={(v) => setFormat(v as AnswerSheetFormat)}
                disabled={isPending}
              >
                <SelectTrigger id="format">
                  <SelectValue placeholder="Selecciona un formato" />
                </SelectTrigger>
                <SelectContent>
                  {ANSWER_SHEET_FORMATS.map((fmt) => (
                    <SelectItem key={fmt} value={fmt}>
                      {FORMAT_LABELS[fmt]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="instrument">Instrumento</Label>
              <Select
                value={instrumentId}
                onValueChange={setInstrumentId}
                disabled={isPending || instruments.length === 0}
              >
                <SelectTrigger id="instrument">
                  <SelectValue
                    placeholder={
                      instruments.length === 0
                        ? 'No hay instrumentos disponibles'
                        : 'Selecciona un instrumento'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {instruments.map((inst) => (
                    <SelectItem key={inst.id} value={inst.id}>
                      {inst.name}
                      {inst.year ? ` · ${inst.year}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {instruments.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  Primero debes importar la pauta del instrumento desde{' '}
                  <a href={ROUTES.importarInstrumento} className="underline hover:text-foreground">
                    Pauta / Instrumento
                  </a>
                  .
                </p>
              )}
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="assessment-name">Nombre de la evaluación (opcional)</Label>
              <Input
                id="assessment-name"
                placeholder="Por ejemplo: DIA Lectura 2° básico — Marzo 2026"
                value={assessmentName}
                onChange={(e) => setAssessmentName(e.target.value)}
                disabled={isPending}
                maxLength={300}
              />
              <p className="text-muted-foreground text-xs">
                Si no lo completas, se generará un nombre automáticamente.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {needsMapping && file && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3. Mapeo de columnas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {parsingHeaders ? (
              <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Leyendo encabezado del archivo…
              </p>
            ) : detectedColumns.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No se detectaron columnas en el archivo. Verifica que el CSV tenga una fila de
                encabezado.
              </p>
            ) : (
              <>
                <p className="text-muted-foreground text-sm">
                  Indica qué columna del CSV corresponde a cada dato. Detectamos un mapeo inicial;
                  ajústalo si es necesario.
                </p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="map-rut">Columna RUT</Label>
                    <Select
                      value={rutCol || NONE}
                      onValueChange={(v) => setRutCol(v === NONE ? '' : v)}
                      disabled={isPending}
                    >
                      <SelectTrigger id="map-rut">
                        <SelectValue placeholder="Selecciona una columna" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>— ninguna —</SelectItem>
                        {detectedColumns.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="map-first">Columna Nombres (opcional)</Label>
                    <Select
                      value={firstNameCol || NONE}
                      onValueChange={(v) => setFirstNameCol(v === NONE ? '' : v)}
                      disabled={isPending}
                    >
                      <SelectTrigger id="map-first">
                        <SelectValue placeholder="— ninguna —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>— ninguna —</SelectItem>
                        {detectedColumns.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="map-last">Columna Apellidos (opcional)</Label>
                    <Select
                      value={lastNameCol || NONE}
                      onValueChange={(v) => setLastNameCol(v === NONE ? '' : v)}
                      disabled={isPending}
                    >
                      <SelectTrigger id="map-last">
                        <SelectValue placeholder="— ninguna —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>— ninguna —</SelectItem>
                        {detectedColumns.map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Columnas de preguntas</Label>
                  <p className="text-muted-foreground text-xs">
                    Marca las columnas que contienen las respuestas por pregunta.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {detectedColumns.map((c) => {
                      const active = questionCols.includes(c);
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => toggleQuestionCol(c)}
                          disabled={isPending}
                          aria-pressed={active}
                          className={cn(
                            'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                            active
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-muted-foreground/25 hover:bg-muted',
                          )}
                        >
                          {c}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-muted-foreground pt-1 text-xs">
                    {questionCols.length} columna(s) de pregunta seleccionada(s).
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {errorMessage && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="space-y-0.5">
            <p className="font-medium">No se pudo procesar el archivo</p>
            <p>{errorMessage}</p>
          </div>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(ROUTES.importarResultados)}
          disabled={isPending}
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={
            isPending ||
            !file ||
            !instrumentId ||
            (needsMapping && (!rutCol || questionCols.length === 0))
          }
        >
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isPending ? 'Procesando…' : 'Procesar archivo'}
        </Button>
      </div>
    </form>
  );
}
