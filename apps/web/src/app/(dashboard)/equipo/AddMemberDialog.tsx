'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, UserPlus } from 'lucide-react';
import {
  ASSIGNABLE_SCHOOL_ROLES,
  inviteMemberSchema,
  type AssignableSchoolRole,
} from '@soe/types';
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
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Field } from '@/components/patterns';
import { inviteMember } from './actions';

const ROLE_LABELS: Record<AssignableSchoolRole, string> = {
  school_admin: 'Administrador(a) del colegio',
  academic_director: 'Director(a) académico(a)',
  cycle_director: 'Director(a) de ciclo',
  dept_head: 'Jefe(a) de departamento',
  coordinator: 'Coordinador(a)',
  eval_coordinator: 'Coordinador(a) de evaluación',
  teacher: 'Docente',
  homeroom_teacher: 'Profesor(a) jefe',
};

export function AddMemberDialog() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AssignableSchoolRole>('teacher');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function reset() {
    setEmail('');
    setRole('teacher');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = inviteMemberSchema.safeParse({ email, role });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Datos inválidos');
      return;
    }

    startTransition(async () => {
      try {
        await inviteMember(parsed.data);
        toast.success('Miembro agregado. Avísale para que inicie sesión con Google.');
        setOpen(false);
        reset();
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al invitar');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="mr-2 size-4" />
          Invitar miembro
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Invitar miembro al equipo</DialogTitle>
            <DialogDescription>
              Registra el correo institucional y el rol. La persona podrá iniciar sesión con Google
              de inmediato — no enviamos correo de invitación.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Field label="Correo institucional" htmlFor="member-email" required>
              <Input
                id="member-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="profesor@colegio.cl"
                disabled={pending}
                required
                autoComplete="off"
              />
            </Field>

            <Field label="Rol" htmlFor="member-role" required>
              <Select
                value={role}
                onValueChange={(v) => setRole(v as AssignableSchoolRole)}
                disabled={pending}
              >
                <SelectTrigger id="member-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_SCHOOL_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Invitando…
                </>
              ) : (
                'Invitar'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
