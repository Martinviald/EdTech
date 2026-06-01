'use client';

import { useCallback, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { DiaIngestionRequestDto } from '@soe/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FileDropzone } from '../components/FileDropzone';

export interface CatalogOptions {
  taxonomies: Array<{ id: string; name: string; type: string }>;
  subjects: Array<{ id: string; name: string; shortName: string }>;
  grades: Array<{ id: string; name: string; shortName: string; gradeOrder: number }>;
}

interface UploadStepProps {
  onSubmit: (data: unknown, metadata: DiaIngestionRequestDto) => void;
  isPending: boolean;
  catalogOptions: CatalogOptions;
}

export function UploadStep({ onSubmit, isPending, catalogOptions }: UploadStepProps) {
  const [file, setFile] = useState<File | null>(null);
  const [fileData, setFileData] = useState<unknown>(null);
  const [name, setName] = useState('');
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [taxonomyId, setTaxonomyId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [gradeId, setGradeId] = useState('');
  const [version, setVersion] = useState('');

  const handleFileAccept = useCallback((f: File) => {
    setFile(f);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target?.result as string);
        setFileData(parsed);
        // Auto-fill name from file content if available
        if (parsed?.instrument?.name && !name) {
          setName(parsed.instrument.name);
        }
      } catch {
        toast.error('El archivo no es un JSON valido');
        setFile(null);
        setFileData(null);
      }
    };
    reader.readAsText(f);
  }, [name]);

  const handleSubmit = () => {
    if (!fileData) {
      toast.error('Selecciona un archivo JSON primero');
      return;
    }
    if (!name.trim()) {
      toast.error('Ingresa un nombre para el instrumento');
      return;
    }
    if (!taxonomyId) {
      toast.error('Selecciona un marco acadÃ©mico');
      return;
    }
    if (!subjectId) {
      toast.error('Selecciona una asignatura');
      return;
    }
    if (!gradeId) {
      toast.error('Selecciona un nivel');
      return;
    }

    const yearNum = parseInt(year, 10);
    if (isNaN(yearNum) || yearNum < 2020 || yearNum > 2100) {
      toast.error('El año debe estar entre 2020 y 2100');
      return;
    }

    const metadata: DiaIngestionRequestDto = {
      name: name.trim(),
      year: yearNum,
      taxonomyId,
      subjectId,
      gradeId,
      version: version.trim() || undefined,
    };

    onSubmit(fileData, metadata);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Selecciona el archivo</CardTitle>
        </CardHeader>
        <CardContent>
          {file ? (
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{file.name}</p>
                <p className="text-muted-foreground text-xs">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setFile(null); setFileData(null); }}
              >
                Cambiar
              </Button>
            </div>
          ) : (
            <FileDropzone
              onAccept={handleFileAccept}
              accept={{ 'application/json': ['.json'] }}
              label="Arrastra tu archivo JSON o haz clic para seleccionar"
              hint="Archivo JSON de pauta DIA"
              disabled={isPending}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Metadata del instrumento</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="dia-name">Nombre del instrumento</Label>
              <Input
                id="dia-name"
                placeholder="DIA Lectura 2o Basico 2025"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isPending}
              />
            </div>
            <div>
              <Label htmlFor="dia-year">Año</Label>
              <Input
                id="dia-year"
                type="number"
                min={2020}
                max={2100}
                value={year}
                onChange={(e) => setYear(e.target.value)}
                disabled={isPending}
              />
            </div>
            <div>
              <Label htmlFor="dia-version">Version (opcional)</Label>
              <Input
                id="dia-version"
                placeholder="v1"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                disabled={isPending}
              />
            </div>
            <div>
              <Label htmlFor="dia-taxonomy">Marco acadÃ©mico</Label>
              <select
                id="dia-taxonomy"
                value={taxonomyId}
                onChange={(e) => setTaxonomyId(e.target.value)}
                disabled={isPending}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Selecciona...</option>
                {catalogOptions.taxonomies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="dia-subject">Asignatura</Label>
              <select
                id="dia-subject"
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                disabled={isPending}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Selecciona...</option>
                {catalogOptions.subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="dia-grade">Nivel</Label>
              <select
                id="dia-grade"
                value={gradeId}
                onChange={(e) => setGradeId(e.target.value)}
                disabled={isPending}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Selecciona...</option>
                {catalogOptions.grades.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSubmit} disabled={!fileData || isPending}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isPending ? 'Procesando...' : 'Vista previa'}
        </Button>
      </div>
    </div>
  );
}
