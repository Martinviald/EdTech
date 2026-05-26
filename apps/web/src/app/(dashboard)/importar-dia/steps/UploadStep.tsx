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

interface UploadStepProps {
  onSubmit: (data: unknown, metadata: DiaIngestionRequestDto) => void;
  isPending: boolean;
}

export function UploadStep({ onSubmit, isPending }: UploadStepProps) {
  const [file, setFile] = useState<File | null>(null);
  const [fileData, setFileData] = useState<unknown>(null);
  const [name, setName] = useState('');
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [curriculumId, setCurriculumId] = useState('');
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
    if (!curriculumId.trim()) {
      toast.error('Ingresa el ID del curriculum');
      return;
    }
    if (!subjectId.trim()) {
      toast.error('Ingresa el ID de la asignatura');
      return;
    }
    if (!gradeId.trim()) {
      toast.error('Ingresa el ID del nivel');
      return;
    }

    const yearNum = parseInt(year, 10);
    if (isNaN(yearNum) || yearNum < 2020 || yearNum > 2100) {
      toast.error('El anio debe estar entre 2020 y 2100');
      return;
    }

    const metadata: DiaIngestionRequestDto = {
      name: name.trim(),
      year: yearNum,
      curriculumId: curriculumId.trim(),
      subjectId: subjectId.trim(),
      gradeId: gradeId.trim(),
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
              <Label htmlFor="dia-year">Anio</Label>
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
              <Label htmlFor="dia-curriculum">ID Curriculum</Label>
              <Input
                id="dia-curriculum"
                placeholder="UUID del curriculum"
                value={curriculumId}
                onChange={(e) => setCurriculumId(e.target.value)}
                disabled={isPending}
              />
            </div>
            <div>
              <Label htmlFor="dia-subject">ID Asignatura</Label>
              <Input
                id="dia-subject"
                placeholder="UUID de la asignatura"
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                disabled={isPending}
              />
            </div>
            <div>
              <Label htmlFor="dia-grade">ID Nivel</Label>
              <Input
                id="dia-grade"
                placeholder="UUID del nivel"
                value={gradeId}
                onChange={(e) => setGradeId(e.target.value)}
                disabled={isPending}
              />
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
