import { fireEvent, render, screen } from '@testing-library/react';
import { ActiveFilterChips, FilterMenu, type FilterDimension } from './FilterMenu';

function dimension(overrides: Partial<FilterDimension> = {}): FilterDimension {
  return {
    key: 'subjectId',
    label: 'Asignatura',
    mode: 'multi',
    options: [
      { id: 'lang', label: 'Lenguaje' },
      { id: 'math', label: 'Matemática' },
      { id: 'hist', label: 'Historia' },
    ],
    selected: [],
    onChange: jest.fn(),
    ...overrides,
  };
}

describe('ActiveFilterChips', () => {
  it('no renderiza nada sin filtros aplicados', () => {
    const { container } = render(<ActiveFilterChips dimensions={[dimension()]} />);
    expect(container.firstChild).toBeNull();
  });

  it('muestra un chip por dimensión con los valores y resume el resto como +N', () => {
    render(<ActiveFilterChips dimensions={[dimension({ selected: ['lang', 'math', 'hist'] })]} />);
    expect(screen.getByText('Asignatura:')).toBeTruthy();
    expect(screen.getByText('Lenguaje, Matemática +1')).toBeTruthy();
  });

  it('quita el filtro de esa dimensión al pulsar la equis', () => {
    const onChange = jest.fn();
    render(<ActiveFilterChips dimensions={[dimension({ selected: ['lang'], onChange })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtro de asignatura' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('no muestra dimensiones ocultas aunque tengan selección', () => {
    const { container } = render(
      <ActiveFilterChips dimensions={[dimension({ selected: ['lang'], hidden: true })]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('ofrece limpiar todo sólo con más de un filtro aplicado', () => {
    const onClearAll = jest.fn();
    render(
      <ActiveFilterChips
        dimensions={[
          dimension({ selected: ['lang'] }),
          dimension({ key: 'gradeId', label: 'Nivel', selected: ['lang'] }),
        ]}
        onClearAll={onClearAll}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(onClearAll).toHaveBeenCalled();
  });
});

describe('FilterMenu', () => {
  it('cuenta en el botón las dimensiones con filtro aplicado', () => {
    render(
      <FilterMenu
        dimensions={[
          dimension({ selected: ['lang', 'math'] }),
          dimension({ key: 'gradeId', label: 'Nivel', selected: [] }),
          dimension({ key: 'classGroupId', label: 'Curso', selected: ['x'] }),
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: /Filtros/ }).textContent).toBe('Filtros2');
  });
});
