'use client';

import { useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Field, TopProgressBar } from '@/components/shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DesignIdentityMode } from './identity-mode';

const MODE_HINTS: Record<DesignIdentityMode, string> = {
  qr: 'Cada hoja se imprime con el nombre y el QR propios de un alumno del curso.',
  rut_bubbles:
    'Todas las hojas son idénticas: el alumno escribe su nombre y marca su RUT en una grilla de burbujas.',
};

export function IdentityModeSelector({ mode }: { mode: DesignIdentityMode }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const pathname = usePathname();

  function handleChange(value: string) {
    const target = value === 'rut_bubbles' ? `${pathname}?identidad=rut` : pathname;
    startTransition(() => router.replace(target, { scroll: false }));
  }

  return (
    <div className="relative max-w-md">
      <TopProgressBar active={pending} />
      <Field
        label="Identificación de la hoja"
        htmlFor="identity-mode"
        hint={MODE_HINTS[mode]}
      >
        <Select value={mode} onValueChange={handleChange} disabled={pending}>
          <SelectTrigger id="identity-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="qr">QR por alumno</SelectItem>
            <SelectItem value="rut_bubbles">Genérica con RUT</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}
