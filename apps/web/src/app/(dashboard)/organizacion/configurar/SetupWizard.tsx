'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { updateOrgProfile, setupAcademicYear } from './actions';
import type { Grade, Organization, Subject } from '@soe/db';

// ── Tipos internos del wizard ─────────────────────────────────────────────────

type Dependence = 'municipal' | 'particular_pagado' | 'particular_subvencionado' | 'delegada';

interface ProfileData {
  name: string;
  rbd: string;
  commune: string;
  region: string;
  dependence: Dependence | '';
}

interface GradeSection {
  gradeId: string;
  sections: string[];
}

interface WizardData {
  profile: ProfileData;
  selectedGradeIds: string[];
  classGroups: GradeSection[];
  subjectIds: string[];
}

type Step = 1 | 2 | 3 | 4 | 5;

// ── Constantes ────────────────────────────────────────────────────────────────

const DEPENDENCE_LABELS: Record<Dependence, string> = {
  municipal: 'Municipal',
  particular_pagado: 'Particular Pagado',
  particular_subvencionado: 'Particular Subvencionado',
  delegada: 'Corporación Delegada',
};

const CYCLE_LABELS: Record<number, string> = {
  1: 'Primer Ciclo (1° - 4° Básico)',
  2: 'Segundo Ciclo (5° - 8° Básico)',
  3: 'Enseñanza Media (1° - 4° Medio)',
};

const CURRENT_YEAR = new Date().getFullYear();

function generateSectionNames(count: number, gradeShort: string): string[] {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  return letters.slice(0, count).map((l) => `${gradeShort} ${l}`);
}

// ── Componente principal ──────────────────────────────────────────────────────

interface SetupWizardProps {
  org: Organization;
  grades: Grade[];
  subjects: Subject[];
}

export function SetupWizard({ org, grades, subjects }: SetupWizardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>(1);

  const [data, setData] = useState<WizardData>({
    profile: {
      name: org.name,
      rbd: org.rbd ?? '',
      commune: org.commune ?? '',
      region: org.region ?? '',
      dependence: (org.dependence as Dependence) ?? '',
    },
    selectedGradeIds: [],
    classGroups: [],
    subjectIds: [],
  });

  // ── Agrupación de grades por ciclo ───────────────────────────────────────

  const gradesByCycle = grades.reduce<Record<number, Grade[]>>((acc, g) => {
    const bucket = acc[g.cycle] ?? [];
    bucket.push(g);
    acc[g.cycle] = bucket;
    return acc;
  }, {});

  // ── Manejadores de pasos ─────────────────────────────────────────────────

  function handleProfileChange(field: keyof ProfileData, value: string) {
    setData((prev) => ({ ...prev, profile: { ...prev.profile, [field]: value } }));
  }

  function toggleGrade(gradeId: string) {
    setData((prev) => {
      const selected = prev.selectedGradeIds.includes(gradeId)
        ? prev.selectedGradeIds.filter((id) => id !== gradeId)
        : [...prev.selectedGradeIds, gradeId];

      // Sincronizar classGroups: agregar o quitar según selección
      const classGroups = selected.map((gId) => {
        const existing = prev.classGroups.find((cg) => cg.gradeId === gId);
        if (existing) return existing;
        const grade = grades.find((g) => g.id === gId);
        return { gradeId: gId, sections: generateSectionNames(1, grade?.shortName ?? '') };
      });

      return { ...prev, selectedGradeIds: selected, classGroups };
    });
  }

  function setSectionCount(gradeId: string, count: number) {
    const grade = grades.find((g) => g.id === gradeId);
    setData((prev) => ({
      ...prev,
      classGroups: prev.classGroups.map((cg) =>
        cg.gradeId === gradeId
          ? { ...cg, sections: generateSectionNames(count, grade?.shortName ?? '') }
          : cg,
      ),
    }));
  }

  function toggleSubject(subjectId: string) {
    setData((prev) => ({
      ...prev,
      subjectIds: prev.subjectIds.includes(subjectId)
        ? prev.subjectIds.filter((id) => id !== subjectId)
        : [...prev.subjectIds, subjectId],
    }));
  }

  // ── Validaciones por paso ────────────────────────────────────────────────

  function canAdvance(): boolean {
    if (step === 1) return data.profile.name.length >= 2;
    if (step === 2) return data.selectedGradeIds.length > 0;
    if (step === 3) return data.classGroups.every((cg) => cg.sections.length > 0);
    if (step === 4) return data.subjectIds.length > 0;
    return true;
  }

  // ── Submit final ─────────────────────────────────────────────────────────

  function handleSubmit() {
    startTransition(async () => {
      try {
        await updateOrgProfile({
          name: data.profile.name,
          rbd: data.profile.rbd || undefined,
          commune: data.profile.commune || undefined,
          region: data.profile.region || undefined,
          dependence: data.profile.dependence || undefined,
        });

        await setupAcademicYear({
          year: CURRENT_YEAR,
          classGroups: data.classGroups,
          subjectIds: data.subjectIds,
        });

        toast.success('Colegio configurado correctamente');
        router.push('/organizacion' as Route);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al guardar la configuración');
      }
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Indicador de progreso */}
      <div className="flex items-center gap-2">
        {([1, 2, 3, 4, 5] as Step[]).map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                s === step
                  ? 'bg-primary text-primary-foreground'
                  : s < step
                    ? 'bg-primary/20 text-primary'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              {s}
            </div>
            {s < 5 && <div className={`h-px w-8 ${s < step ? 'bg-primary' : 'bg-muted'}`} />}
          </div>
        ))}
      </div>

      {/* Paso 1: Datos básicos */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Datos del colegio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Nombre del colegio *</label>
              <Input
                value={data.profile.name}
                onChange={(e) => handleProfileChange('name', e.target.value)}
                placeholder="Colegio San José"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">RBD</label>
              <Input
                value={data.profile.rbd}
                onChange={(e) => handleProfileChange('rbd', e.target.value)}
                placeholder="12345-6"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Dependencia</label>
              <select
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
                value={data.profile.dependence}
                onChange={(e) => handleProfileChange('dependence', e.target.value)}
              >
                <option value="">Seleccionar...</option>
                {(Object.keys(DEPENDENCE_LABELS) as Dependence[]).map((d) => (
                  <option key={d} value={d}>
                    {DEPENDENCE_LABELS[d]}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Región</label>
                <Input
                  value={data.profile.region}
                  onChange={(e) => handleProfileChange('region', e.target.value)}
                  placeholder="Metropolitana"
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Comuna</label>
                <Input
                  value={data.profile.commune}
                  onChange={(e) => handleProfileChange('commune', e.target.value)}
                  placeholder="Ñuñoa"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Paso 2: Niveles */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Ciclos y niveles que imparte el colegio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {Object.entries(gradesByCycle)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([cycle, cycleGrades]) => (
                <div key={cycle} className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">
                    {CYCLE_LABELS[Number(cycle)]}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {cycleGrades.map((grade) => {
                      const selected = data.selectedGradeIds.includes(grade.id);
                      return (
                        <button
                          key={grade.id}
                          type="button"
                          onClick={() => toggleGrade(grade.id)}
                          className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                            selected
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border hover:border-primary/50'
                          }`}
                        >
                          {grade.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      )}

      {/* Paso 3: Secciones por nivel */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Secciones por nivel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.classGroups.map((cg) => {
              const grade = grades.find((g) => g.id === cg.gradeId);
              if (!grade) return null;
              return (
                <div key={cg.gradeId} className="flex items-center justify-between">
                  <span className="text-sm font-medium">{grade.name}</span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSectionCount(cg.gradeId, Math.max(1, cg.sections.length - 1))}
                      disabled={cg.sections.length <= 1}
                    >
                      −
                    </Button>
                    <span className="w-8 text-center text-sm">{cg.sections.length}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSectionCount(cg.gradeId, Math.min(6, cg.sections.length + 1))}
                      disabled={cg.sections.length >= 6}
                    >
                      +
                    </Button>
                    <span className="text-muted-foreground ml-2 text-xs">
                      {cg.sections.join(', ')}
                    </span>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Paso 4: Asignaturas */}
      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>Asignaturas que se imparten</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {subjects.map((subject) => {
                const selected = data.subjectIds.includes(subject.id);
                return (
                  <button
                    key={subject.id}
                    type="button"
                    onClick={() => toggleSubject(subject.id)}
                    className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      selected
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    {subject.name}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Paso 5: Revisión */}
      {step === 5 && (
        <Card>
          <CardHeader>
            <CardTitle>Revisión final</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="space-y-1">
              <p className="font-medium">Colegio</p>
              <p className="text-muted-foreground">{data.profile.name}</p>
              {data.profile.rbd && <p className="text-muted-foreground">RBD: {data.profile.rbd}</p>}
              {data.profile.commune && (
                <p className="text-muted-foreground">
                  {data.profile.commune}
                  {data.profile.region ? `, ${data.profile.region}` : ''}
                </p>
              )}
              {data.profile.dependence && (
                <p className="text-muted-foreground">
                  {DEPENDENCE_LABELS[data.profile.dependence as Dependence]}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <p className="font-medium">Año académico {CURRENT_YEAR}</p>
              <p className="text-muted-foreground">
                {data.classGroups.reduce((acc, cg) => acc + cg.sections.length, 0)} cursos en{' '}
                {data.selectedGradeIds.length} niveles
              </p>
              <ul className="text-muted-foreground space-y-0.5">
                {data.classGroups.map((cg) => {
                  const grade = grades.find((g) => g.id === cg.gradeId);
                  if (!grade) return null;
                  return (
                    <li key={cg.gradeId}>
                      {grade.name}: {cg.sections.join(', ')}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="space-y-1">
              <p className="font-medium">Asignaturas</p>
              <p className="text-muted-foreground">
                {subjects
                  .filter((s) => data.subjectIds.includes(s.id))
                  .map((s) => s.name)
                  .join(', ')}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Navegación */}
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => setStep((s) => (s - 1) as Step)}
          disabled={step === 1 || isPending}
        >
          Atrás
        </Button>
        {step < 5 ? (
          <Button
            onClick={() => setStep((s) => (s + 1) as Step)}
            disabled={!canAdvance()}
          >
            Siguiente
          </Button>
        ) : (
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Guardando...' : 'Confirmar y guardar'}
          </Button>
        )}
      </div>
    </div>
  );
}
