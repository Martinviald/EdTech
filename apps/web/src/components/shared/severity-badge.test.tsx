import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SeverityBadge } from './severity-badge';

afterEach(cleanup);

const REASON =
  'El logro promedio (71,4%) cae en «Requiere mayor apoyo», la banda más baja del instrumento (bajo 78,8%).';

describe('SeverityBadge', () => {
  it('sin motivo es un badge plano, sin botón', () => {
    render(<SeverityBadge severity="high" reason={null} />);

    expect(screen.getByText('Grave')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('el motivo queda disponible para lectores de pantalla', () => {
    render(<SeverityBadge severity="high" reason={REASON} />);

    expect(screen.getByRole('button', { name: `Grave: ${REASON}` })).toBeTruthy();
  });

  it('un toque abre la explicación sin propagar el clic a la fila', () => {
    const navigate = jest.fn();
    render(
      <div onClick={navigate}>
        <SeverityBadge severity="high" reason={REASON} />
      </div>,
    );

    fireEvent.click(screen.getByRole('button'));

    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getAllByText(/cae en «Requiere mayor apoyo»/).length).toBeGreaterThan(0);
  });

  it('con teclado se abre con Enter', () => {
    render(<SeverityBadge severity="medium" reason={REASON} />);

    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });

    expect(screen.getAllByText(/cae en «Requiere mayor apoyo»/).length).toBeGreaterThan(0);
  });
});
