import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { StudentLink } from './student-link';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const STUDENT_ID = '7e570000-0000-4000-8000-000000000001';

describe('StudentLink', () => {
  it('con permiso, el nombre enlaza a la Ficha del estudiante', () => {
    render(
      <StudentLink studentId={STUDENT_ID} roles={['teacher']} className="font-medium">
        Ana Pérez
      </StudentLink>,
    );

    const link = screen.getByRole('link', { name: 'Ana Pérez' });
    expect(link.getAttribute('href')).toBe(`/estudiantes/${STUDENT_ID}`);
    expect(link.className).toContain('font-medium');
  });

  it('basta con uno de los roles del usuario', () => {
    render(
      <StudentLink studentId={STUDENT_ID} roles={['guardian', 'homeroom_teacher']}>
        Ana Pérez
      </StudentLink>,
    );

    expect(screen.getByRole('link', { name: 'Ana Pérez' })).toBeTruthy();
  });

  it('sin permiso, muestra el nombre como texto, sin enlace', () => {
    render(
      <StudentLink studentId={STUDENT_ID} roles={['guardian']} className="font-medium">
        Ana Pérez
      </StudentLink>,
    );

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Ana Pérez').className).toContain('font-medium');
  });

  it('sin roles, no enlaza', () => {
    render(
      <StudentLink studentId={STUDENT_ID} roles={[]}>
        Ana Pérez
      </StudentLink>,
    );

    expect(screen.queryByRole('link')).toBeNull();
  });
});
