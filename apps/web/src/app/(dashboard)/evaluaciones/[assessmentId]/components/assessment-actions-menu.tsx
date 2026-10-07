'use client';

import { Suspense, use } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { ExternalLink, FileText, GitCompareArrows, MoreVertical, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ROUTES } from '@/lib/routes';

export type CompareMenuEntry = {
  href: Route;
  comparableCount: Promise<number>;
};

interface AssessmentActionsMenuProps {
  instrumentId: string;
  showEnunciado: boolean;
  compare: CompareMenuEntry | null;
}

function CompareItem({ entry }: { entry: CompareMenuEntry }) {
  const count = use(entry.comparableCount);
  if (count === 0) {
    return (
      <DropdownMenuItem disabled className="items-start">
        <GitCompareArrows aria-hidden className="mt-0.5" />
        <span className="flex flex-col">
          <span>Comparar con otra evaluación</span>
          <span className="text-xs text-muted-foreground">No hay otra evaluación comparable</span>
        </span>
      </DropdownMenuItem>
    );
  }
  return (
    <DropdownMenuItem asChild>
      <Link href={entry.href}>
        <GitCompareArrows aria-hidden />
        Comparar con otra evaluación
      </Link>
    </DropdownMenuItem>
  );
}

function CompareItemPending() {
  return (
    <DropdownMenuItem disabled>
      <GitCompareArrows aria-hidden />
      Buscando evaluaciones comparables…
    </DropdownMenuItem>
  );
}

export function AssessmentActionsMenu({
  instrumentId,
  showEnunciado,
  compare,
}: AssessmentActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="size-9" aria-label="Más acciones">
          <MoreVertical className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {compare ? (
          <Suspense fallback={<CompareItemPending />}>
            <CompareItem entry={compare} />
          </Suspense>
        ) : null}
        {showEnunciado ? (
          <DropdownMenuItem asChild>
            <a
              href={ROUTES.instrumentoEnunciado(instrumentId)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <FileText aria-hidden />
              Ver enunciado
              <ExternalLink aria-hidden className="ml-auto text-muted-foreground" />
              <span className="sr-only">(se abre en una pestaña nueva)</span>
            </a>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <Link href={ROUTES.bancoItemSpecTable(instrumentId)}>
            <Table2 aria-hidden />
            Tabla de especificaciones
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
