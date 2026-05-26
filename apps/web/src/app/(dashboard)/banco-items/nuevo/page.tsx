'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
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
import type { CreateInstrumentDto, CreateInstrumentSectionDto } from '@soe/types';
import { createInstrument } from '../actions';

const TYPE_OPTIONS = [
  { value: 'dia', label: 'DIA' },
  { value: 'simce', label: 'SIMCE' },
  { value: 'paes', label: 'PAES' },
  { value: 'cambridge_mock', label: 'Cambridge' },
  { value: 'aptus', label: 'Aptus' },
  { value: 'desafio', label: 'Desafio' },
  { value: 'pal', label: 'PAL' },
  { value: 'custom', label: 'Personalizado' },
];

const SECTION_TYPE_OPTIONS = [
  { value: 'multiple_choice', label: 'Seleccion multiple' },
  { value: 'open_ended', label: 'Desarrollo' },
  { value: 'oral', label: 'Oral' },
  { value: 'listening', label: 'Comprension auditiva' },
  { value: 'mixed', label: 'Mixta' },
];

export default function NuevoInstrumentoPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [year, setYear] = useState('');
  const [version, setVersion] = useState('');
  const [sections, setSections] = useState<CreateInstrumentSectionDto[]>([]);

  function addSection() {
    setSections((prev) => [
      ...prev,
      { name: '', type: 'mixed', order: prev.length, maxPoints: undefined },
    ]);
  }

  function updateSection(index: number, updates: Partial<CreateInstrumentSectionDto>) {
    setSections((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...updates } : s)),
    );
  }

  function removeSection(index: number) {
    setSections((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }
    if (!type) {
      setError('El tipo es obligatorio.');
      return;
    }

    const data: CreateInstrumentDto = {
      name: name.trim(),
      type: type as CreateInstrumentDto['type'],
      isOfficial: false,
      year: year ? parseInt(year, 10) : undefined,
      version: version.trim() || undefined,
      sections: sections.length > 0 ? sections : undefined,
    };

    setIsSubmitting(true);
    try {
      const result = await createInstrument(data);
      router.push(`/banco-items/${result.id}` as Route);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear el instrumento.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href={'/banco-items' as Route} className="hover:text-foreground">
            Banco de Items
          </Link>
          <span>/</span>
          <span>Nuevo instrumento</span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold">Crear instrumento</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Define el instrumento de evaluacion y sus secciones.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        {error && (
          <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Informacion general</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre *</Label>
              <Input
                id="name"
                placeholder="Ej: Diagnostico Integral de Aprendizajes - Lectura 4to basico"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="type">Tipo *</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger id="type">
                    <SelectValue placeholder="Seleccionar tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="year">Ano</Label>
                <Input
                  id="year"
                  type="number"
                  placeholder="2025"
                  min={2000}
                  max={2100}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="version">Version</Label>
              <Input
                id="version"
                placeholder="Ej: 1.0, 2025-1"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Secciones</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={addSection}>
              Agregar seccion
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {sections.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Opcional. Puedes agregar secciones para organizar los items del instrumento.
              </p>
            ) : (
              sections.map((section, index) => (
                <div key={index} className="flex items-end gap-3 rounded-md border p-3">
                  <div className="flex-1 space-y-2">
                    <Label>Nombre</Label>
                    <Input
                      placeholder="Ej: Lectura"
                      value={section.name}
                      onChange={(e) => updateSection(index, { name: e.target.value })}
                    />
                  </div>
                  <div className="w-[160px] space-y-2">
                    <Label>Tipo</Label>
                    <Select
                      value={section.type}
                      onValueChange={(v) =>
                        updateSection(index, { type: v as CreateInstrumentSectionDto['type'] })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SECTION_TYPE_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-[80px] space-y-2">
                    <Label>Pts max</Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="--"
                      value={section.maxPoints ?? ''}
                      onChange={(e) =>
                        updateSection(index, {
                          maxPoints: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => removeSection(index)}
                  >
                    Eliminar
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creando...' : 'Crear instrumento'}
          </Button>
          <Link href={'/banco-items' as Route}>
            <Button type="button" variant="outline">
              Cancelar
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
