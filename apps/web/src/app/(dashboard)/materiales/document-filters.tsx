'use client';

import { useCallback, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import {
  DOCUMENT_TYPES,
  documentStatusSchema,
  type CatalogEntryModel,
} from '@soe/types';
import { ROUTES } from '@/lib/routes';
import { TopProgressBar } from '@/components/shared';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DOCUMENT_STATUS_LABELS, DOCUMENT_TYPE_LABELS } from './labels';

const ALL = 'all';

type DocumentFiltersProps = {
  subjects: CatalogEntryModel[];
  grades: CatalogEntryModel[];
};

export function DocumentFilters({ subjects, grades }: DocumentFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const currentType = searchParams.get('type') ?? '';
  const currentStatus = searchParams.get('status') ?? '';
  const currentSubject = searchParams.get('subjectId') ?? '';
  const currentGrade = searchParams.get('gradeId') ?? '';
  const onlyMine = searchParams.get('mine') === 'true';

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== ALL) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.set('page', '1');
      startTransition(() => {
        router.push(`${ROUTES.materiales}?${params.toString()}` as Route);
      });
    },
    [router, searchParams],
  );

  return (
    <div className="relative flex flex-wrap items-center gap-3">
      <TopProgressBar active={isPending} />
      <Select value={currentType || ALL} onValueChange={(v) => updateFilter('type', v)}>
        <SelectTrigger className="w-[190px]" aria-label="Tipo de material">
          <SelectValue placeholder="Tipo" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos los tipos</SelectItem>
          {DOCUMENT_TYPES.map((type) => (
            <SelectItem key={type} value={type}>
              {DOCUMENT_TYPE_LABELS[type]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={currentStatus || ALL} onValueChange={(v) => updateFilter('status', v)}>
        <SelectTrigger className="w-[150px]" aria-label="Estado">
          <SelectValue placeholder="Estado" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos los estados</SelectItem>
          {documentStatusSchema.options.map((status) => (
            <SelectItem key={status} value={status}>
              {DOCUMENT_STATUS_LABELS[status]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={currentSubject || ALL} onValueChange={(v) => updateFilter('subjectId', v)}>
        <SelectTrigger className="w-[180px]" aria-label="Asignatura">
          <SelectValue placeholder="Asignatura" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todas las asignaturas</SelectItem>
          {subjects.map((subject) => (
            <SelectItem key={subject.id} value={subject.id}>
              {subject.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={currentGrade || ALL} onValueChange={(v) => updateFilter('gradeId', v)}>
        <SelectTrigger className="w-[160px]" aria-label="Nivel">
          <SelectValue placeholder="Nivel" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Todos los niveles</SelectItem>
          {grades.map((grade) => (
            <SelectItem key={grade.id} value={grade.id}>
              {grade.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        type="button"
        variant={onlyMine ? 'secondary' : 'outline'}
        size="sm"
        onClick={() => updateFilter('mine', onlyMine ? '' : 'true')}
      >
        Solo mis materiales
      </Button>
    </div>
  );
}
