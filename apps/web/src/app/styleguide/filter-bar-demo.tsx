'use client';

import { useState } from 'react';

import { FilterBar, type FilterField } from '@/components/shared';

export function FilterBarDemo() {
  const [subject, setSubject] = useState('');
  const [grade, setGrade] = useState('');

  const fields: FilterField[] = [
    {
      key: 'subject',
      label: 'Asignatura',
      placeholder: 'Todas las asignaturas',
      value: subject,
      options: [
        { id: 'mat', label: 'Matemática' },
        { id: 'len', label: 'Lenguaje' },
      ],
      onChange: setSubject,
    },
    {
      key: 'grade',
      label: 'Nivel',
      placeholder: 'Todos los niveles',
      value: grade,
      options: [
        { id: '3b', label: '3° básico' },
        { id: '4b', label: '4° básico' },
      ],
      onChange: setGrade,
    },
  ];

  return <FilterBar fields={fields} />;
}
