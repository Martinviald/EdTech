import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import type { SubmitReviewDto } from '@soe/types';
import { ReviewGroupPanel, type ReviewGroupPanelProps } from './ReviewGroupPanel';
import { DECISION_A, DECISION_B, DECISION_C, gradingGroup, readingGroup } from './test-fixtures';

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), warning: jest.fn(), success: jest.fn() },
}));

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

function renderPanel(overrides: Partial<ReviewGroupPanelProps> = {}) {
  const props: ReviewGroupPanelProps = {
    group: readingGroup(),
    position: 1,
    total: 2,
    pending: false,
    canUndo: false,
    onSubmit: jest.fn(),
    onNext: jest.fn(),
    onPrev: jest.fn(),
    onUndo: jest.fn(),
    ...overrides,
  };
  render(<ReviewGroupPanel {...props} />);
  return { ...props, panel: screen.getByRole('group', { name: /Grupo 1 de 2/ }) };
}

function submitted(onSubmit: jest.Mock): SubmitReviewDto {
  expect(onSubmit).toHaveBeenCalledTimes(1);
  return onSubmit.mock.calls[0][0] as SubmitReviewDto;
}

describe('ReviewGroupPanel en modo lectura', () => {
  it('ofrece las acciones de lectura y no muestra la clave ni la propuesta de corrección', () => {
    renderPanel({
      group: readingGroup({
        grading: {
          acceptedAnswers: ['99/7'],
          unit: null,
          proposedOutcome: 'correct',
          optionOutcomes: [{ literal: '21/10', outcome: 'incorrect' }],
        },
      }),
    });

    expect(screen.getByText('¿Qué escribió el alumno?')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Marcar como ilegible/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Marcar como en blanco/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Marcar como tachada/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Marcar como correcta/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Marcar como incorrecta/ })).toBeNull();
    expect(screen.queryByText(/Clave/)).toBeNull();
    expect(screen.queryByText('99/7')).toBeNull();
    expect(screen.queryByText('Correcta')).toBeNull();
    expect(screen.queryByText('Incorrecta')).toBeNull();
  });

  it('muestra cada lector con su confianza, sus alternativas y los motivos en español', () => {
    renderPanel();
    expect(screen.getByText('Los lectores no coinciden')).toBeTruthy();
    expect(screen.getByText(/Alternativas: 21\/16 \(0,30\)/)).toBeTruthy();
    expect(screen.getAllByText(/confianza 0,62/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Recorte no disponible').length).toBeGreaterThan(0);
  });

  it('con 1..9 acepta la lectura elegida para todo el grupo', () => {
    const { panel, onSubmit } = renderPanel();
    fireEvent.keyDown(panel, { key: '2' });
    expect(submitted(onSubmit as jest.Mock)).toEqual({
      decisionIds: [DECISION_A, DECISION_B, DECISION_C],
      mode: 'reading',
      action: 'accept',
      editedLiteral: '21/16',
    });
  });

  it('A acepta la lectura propuesta e I, B y T marcan el estado', () => {
    const cases: Array<[string, string]> = [
      ['a', 'accept'],
      ['i', 'illegible'],
      ['b', 'blank'],
      ['t', 'crossed_out'],
    ];
    for (const [key, action] of cases) {
      const { panel, onSubmit } = renderPanel();
      fireEvent.keyDown(panel, { key });
      const dto = submitted(onSubmit as jest.Mock);
      expect(dto.action).toBe(action);
      expect(dto.editedLiteral).toBeUndefined();
      cleanup();
    }
  });

  it('ignora C y X, que son del modo corrección', () => {
    const { panel, onSubmit } = renderPanel();
    fireEvent.keyDown(panel, { key: 'c' });
    fireEvent.keyDown(panel, { key: 'x' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Shift+clic quita una miniatura del grupo antes de aceptar', () => {
    const { panel, onSubmit } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Respuesta 2 de 3/ }), { shiftKey: true });
    expect(
      screen.getByRole('button', { name: /Respuesta 2 de 3, quitada del grupo/ }),
    ).toBeTruthy();
    fireEvent.keyDown(panel, { key: 'a' });
    expect(submitted(onSubmit as jest.Mock).decisionIds).toEqual([DECISION_A, DECISION_C]);
  });

  it('navega y deshace con el teclado', () => {
    const { panel, onNext, onPrev, onUndo } = renderPanel({ canUndo: true });
    fireEvent.keyDown(panel, { key: 'Enter' });
    fireEvent.keyDown(panel, { key: 'ArrowRight' });
    fireEvent.keyDown(panel, { key: 'ArrowLeft' });
    fireEvent.keyDown(panel, { key: 'u' });
    expect(onNext).toHaveBeenCalledTimes(2);
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('E abre la edición con dos cajas de fracción y valida antes de enviar', () => {
    const { panel, onSubmit } = renderPanel();
    fireEvent.keyDown(panel, { key: 'e' });

    const numerator = screen.getByLabelText('Numerador') as HTMLInputElement;
    const denominator = screen.getByLabelText('Denominador') as HTMLInputElement;
    expect(numerator.value).toBe('21');
    expect(denominator.value).toBe('10');

    fireEvent.change(denominator, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar edición/ }));
    expect(toast.error).toHaveBeenCalledWith('El denominador no puede ser 0');
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(denominator, { target: { value: '16' } });
    fireEvent.keyDown(denominator, { key: 'i' });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Guardar edición/ }));
    expect(submitted(onSubmit as jest.Mock)).toMatchObject({
      action: 'edit',
      mode: 'reading',
      editedLiteral: '21/16',
    });
  });

  it('edita un par con la forma ( ; )', () => {
    const { panel, onSubmit } = renderPanel({
      group: readingGroup({ formatKind: 'ordered_tuple', displayValue: '(2;4)', readers: [] }),
    });
    fireEvent.keyDown(panel, { key: 'e' });
    fireEvent.change(screen.getByLabelText('Componente 2 del par'), { target: { value: '-4' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar edición/ }));
    expect(submitted(onSubmit as jest.Mock).editedLiteral).toBe('(2;-4)');
  });
});

describe('ReviewGroupPanel en modo corrección', () => {
  it('muestra la clave y el resultado de cada opción, con las acciones de corrección', () => {
    renderPanel({ group: gradingGroup() });
    expect(screen.getByText('¿Esta respuesta es correcta?')).toBeTruthy();
    expect(screen.getByLabelText('Clave').textContent).toContain('21/10');
    expect(screen.getByRole('list', { name: 'Resultado de cada opción' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Marcar como correcta/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Marcar como incorrecta/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Marcar como ilegible/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Marcar como en blanco/ })).toBeNull();
  });

  it('C marca correcta, X incorrecta y A aplica la propuesta', () => {
    const cases: Array<[string, string]> = [
      ['c', 'mark_correct'],
      ['x', 'mark_incorrect'],
      ['a', 'mark_correct'],
    ];
    for (const [key, action] of cases) {
      const { panel, onSubmit } = renderPanel({ group: gradingGroup() });
      fireEvent.keyDown(panel, { key });
      expect(submitted(onSubmit as jest.Mock)).toEqual({
        decisionIds: [DECISION_A, DECISION_B, DECISION_C],
        mode: 'grading',
        action,
      });
      cleanup();
    }
  });

  it('ignora las teclas que solo existen en modo lectura', () => {
    const { panel, onSubmit } = renderPanel({ group: gradingGroup() });
    for (const key of ['1', 'i', 'b', 't']) fireEvent.keyDown(panel, { key });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
