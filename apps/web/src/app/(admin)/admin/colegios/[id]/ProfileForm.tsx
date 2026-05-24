'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import type { AdminOrgDetail } from '@/lib/adminApi';
import {
  restoreOrgAction,
  softDeleteOrgAction,
  updateOrgAction,
} from './actions';

const DEPENDENCE_OPTIONS = [
  { value: 'municipal', label: 'Municipal' },
  { value: 'particular_subvencionado', label: 'Particular Subvencionado' },
  { value: 'particular_pagado', label: 'Particular Pagado' },
  { value: 'delegada', label: 'Corporación Delegada' },
] as const;

const TYPE_OPTIONS = [
  { value: 'school', label: 'Colegio' },
  { value: 'foundation', label: 'Fundación' },
] as const;

export function ProfileForm({ org }: { org: AdminOrgDetail }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isDeleted = org.deletedAt !== null;

  const onSubmit = (formData: FormData) => {
    startTransition(async () => {
      const result = await updateOrgAction(org.id, formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Perfil actualizado');
      router.refresh();
    });
  };

  const onDelete = () => {
    startTransition(async () => {
      const result = await softDeleteOrgAction(org.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Colegio dado de baja');
      router.refresh();
    });
  };

  const onRestore = () => {
    startTransition(async () => {
      const result = await restoreOrgAction(org.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Colegio restaurado');
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <form action={onSubmit} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Nombre" required>
            <Input
              name="name"
              defaultValue={org.name}
              required
              minLength={2}
              maxLength={200}
              disabled={isDeleted || isPending}
            />
          </Field>
          <Field label="RBD" hint="Formato: 12345-6">
            <Input
              name="rbd"
              defaultValue={org.rbd ?? ''}
              pattern="\d{5}-\d"
              placeholder="12345-6"
              disabled={isDeleted || isPending}
            />
          </Field>
          <Field label="Comuna">
            <Input
              name="commune"
              defaultValue={org.commune ?? ''}
              maxLength={100}
              disabled={isDeleted || isPending}
            />
          </Field>
          <Field label="Región">
            <Input
              name="region"
              defaultValue={org.region ?? ''}
              maxLength={100}
              disabled={isDeleted || isPending}
            />
          </Field>
          <Field label="Dependencia">
            <Select
              name="dependence"
              defaultValue={org.dependence ?? undefined}
              disabled={isDeleted || isPending}
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {DEPENDENCE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field
            label="Tipo de organización"
            hint="Solo se puede cambiar si no hay alumnos ni cursos asociados."
          >
            <Select
              name="type"
              defaultValue={org.type === 'platform' ? undefined : org.type}
              disabled={isDeleted || isPending || org.type === 'platform'}
            >
              <SelectTrigger>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={isDeleted || isPending}>
            {isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Guardar cambios
          </Button>
        </div>
      </form>

      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
        <h3 className="text-sm font-semibold text-destructive">Zona de riesgo</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {isDeleted
            ? 'Este colegio está dado de baja. No aparece en listados ni puede operar.'
            : 'Dar de baja oculta el colegio del listado y deshabilita su uso. La acción es reversible.'}
        </p>
        <div className="mt-3 flex gap-2">
          {isDeleted ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onRestore}
              disabled={isPending}
            >
              <RotateCcw className="mr-2 size-4" /> Restaurar colegio
            </Button>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={isPending}>
                  <Trash2 className="mr-2 size-4" /> Dar de baja
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Dar de baja {org.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    El colegio desaparecerá del listado y nadie podrá operar sobre él. La
                    acción se puede revertir desde esta misma pantalla activando el filtro
                    &ldquo;Incluir dados de baja&rdquo;.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete}>Sí, dar de baja</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
