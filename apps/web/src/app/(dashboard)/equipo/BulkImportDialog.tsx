'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CheckCircle2, FileSpreadsheet, Upload, XCircle } from 'lucide-react';
import type { BulkInviteResponse } from '@soe/types';
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
import { parseMembersCsv, type ParsedMembersCsv } from '@/lib/csv-parser';
import { bulkInviteMembers } from './actions';

const SAMPLE_CSV = 'email,role\nprofesor1@colegio.cl,teacher\nprofesor2@colegio.cl,coordinator\n';

const SAMPLE_CSV_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE_CSV)}`;

export function BulkImportDialog() {
  const [open, setOpen] = useState(false);
  const [filename, setFilename] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedMembersCsv | null>(null);
  const [parsing, setParsing] = useState(false);
  const [submitting, startTransition] = useTransition();
  const [result, setResult] = useState<BulkInviteResponse | null>(null);
  const router = useRouter();

  function reset() {
    setFilename(null);
    setParsed(null);
    setResult(null);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    setResult(null);
    setParsing(true);
    try {
      const out = await parseMembersCsv(file);
      setParsed(out);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al parsear el CSV');
      setParsed(null);
    } finally {
      setParsing(false);
    }
  }

  function handleImport() {
    if (!parsed || parsed.valid.length === 0) return;
    startTransition(async () => {
      try {
        const r = await bulkInviteMembers({ members: parsed.valid });
        setResult(r);
        toast.success(`${r.created} miembro(s) agregado(s)`);
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al importar');
      }
    });
  }

  function handleClose(open: boolean) {
    setOpen(open);
    if (!open) reset();
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="mr-2 size-4" />
          Importar CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar miembros desde CSV</DialogTitle>
          <DialogDescription>
            Sube un archivo con columnas <code className="bg-muted rounded px-1">email,role</code>.{' '}
            <a
              href={SAMPLE_CSV_HREF}
              download="equipo-template.csv"
              className="text-primary underline-offset-2 hover:underline"
            >
              Descargar template
            </a>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!result && (
            <label
              htmlFor="csv-file"
              className="hover:bg-muted/50 flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center transition-colors"
            >
              <FileSpreadsheet className="text-muted-foreground size-8" aria-hidden />
              <div className="text-sm font-medium">
                {filename ?? 'Haz click para seleccionar un archivo'}
              </div>
              <div className="text-muted-foreground text-xs">CSV con encabezado email,role</div>
              <input
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                onChange={handleFile}
                className="sr-only"
                disabled={parsing || submitting}
              />
            </label>
          )}

          {parsing && (
            <p className="text-muted-foreground text-center text-sm">Parseando archivo…</p>
          )}

          {parsed && !result && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="inline-flex items-center gap-1 rounded-md bg-success/10 px-2 py-1 text-success">
                  <CheckCircle2 className="size-4" />
                  {parsed.valid.length} válidos
                </span>
                {parsed.errors.length > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-2 py-1 text-warning">
                    <XCircle className="size-4" />
                    {parsed.errors.length} con errores
                  </span>
                )}
              </div>

              {parsed.errors.length > 0 && (
                <details className="rounded-md border bg-card p-3 text-sm">
                  <summary className="cursor-pointer font-medium">
                    Ver filas con errores ({parsed.errors.length})
                  </summary>
                  <ul className="text-muted-foreground mt-2 space-y-1">
                    {parsed.errors.slice(0, 20).map((e, i) => (
                      <li key={i} className="font-mono text-xs">
                        Fila {e.row} ({e.raw.email || 'sin email'}): {e.message}
                      </li>
                    ))}
                    {parsed.errors.length > 20 && (
                      <li className="text-xs italic">… y {parsed.errors.length - 20} más</li>
                    )}
                  </ul>
                </details>
              )}
            </div>
          )}

          {result && (
            <div className="space-y-3">
              <div className="rounded-md border bg-success/10 p-3 text-sm text-success">
                <strong>{result.created}</strong> miembro(s) agregado(s) correctamente.
                {result.skipped.length > 0 && (
                  <>
                    {' '}
                    <strong>{result.skipped.length}</strong> omitido(s).
                  </>
                )}
              </div>

              {result.skipped.length > 0 && (
                <details className="rounded-md border bg-card p-3 text-sm">
                  <summary className="cursor-pointer font-medium">Ver miembros omitidos</summary>
                  <ul className="text-muted-foreground mt-2 space-y-1">
                    {result.skipped.map((s, i) => (
                      <li key={i} className="font-mono text-xs">
                        {s.email} ({s.role}): {s.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {result ? (
            <Button onClick={() => handleClose(false)}>Cerrar</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => handleClose(false)} disabled={submitting}>
                Cancelar
              </Button>
              <Button
                onClick={handleImport}
                disabled={!parsed || parsed.valid.length === 0 || submitting}
              >
                {submitting
                  ? 'Importando…'
                  : parsed
                    ? `Importar ${parsed.valid.length} válidos`
                    : 'Importar'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
