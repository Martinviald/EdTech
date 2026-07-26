'use client';

// TKT-14 — Selector de alcance del banco de ítems: propio / global / todos.
// Escribe el alcance en la URL (`?scope=`) para que el Server Component vuelva a
// pedir `GET /items?scope=…` con el origen elegido.

import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ITEM_BANK_SCOPES, type ItemBankScope } from '@soe/types';
import { ROUTES } from '@/lib/routes';

const SCOPE_LABELS: Record<ItemBankScope, string> = {
  own: 'Mis ítems',
  global: 'Ítems globales',
  all: 'Todos los ítems',
};

export function ItemBankScopeSelect({ value }: { value: ItemBankScope }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const onChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('scope', next);
    router.push(`${ROUTES.bancoItemsExplorar}?${params.toString()}` as Route);
  };

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[180px]">
        <SelectValue placeholder="Alcance" />
      </SelectTrigger>
      <SelectContent>
        {ITEM_BANK_SCOPES.map((scope) => (
          <SelectItem key={scope} value={scope}>
            {SCOPE_LABELS[scope]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
