import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RubricReviewDetail } from '@soe/types';
import { apiClientGet } from '@/lib/api-client';
import {
  RubricReviewPanel,
  levelShortcuts,
  type RubricReviewPanelProps,
} from './RubricReviewPanel';
import { RUBRIC_DECISION, rubricDetail, rubricGroup } from './test-fixtures';

jest.mock('@/lib/api-client', () => ({
  apiClientGet: jest.fn(),
  apiClientPost: jest.fn(),
}));

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), warning: jest.fn(), success: jest.fn() },
}));

const getMock = apiClientGet as jest.MockedFunction<typeof apiClientGet>;
const BATCH_ID = '55555555-5555-4555-8555-555555555555';

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

async function renderPanel(
  detail: RubricReviewDetail = rubricDetail(),
  overrides: Partial<RubricReviewPanelProps> = {},
) {
  getMock.mockResolvedValue(detail);
  const props: RubricReviewPanelProps = {
    scope: { batchId: BATCH_ID },
    group: rubricGroup(),
    position: 1,
    total: 1,
    pending: false,
    canUndo: false,
    onApprove: jest.fn(),
    onNext: jest.fn(),
    onPrev: jest.fn(),
    onUndo: jest.fn(),
    ...overrides,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RubricReviewPanel {...props} />
    </QueryClientProvider>,
  );
  await screen.findByText('Transcripción');
  return { ...props, panel: screen.getByRole('group', { name: /calificación con rúbrica/ }) };
}

describe('RubricReviewPanel', () => {
  it('muestra la propuesta de la IA, su justificación y resalta las citas en la transcripción', async () => {
    await renderPanel();

    expect(getMock).toHaveBeenCalledWith(`/answer-reading/rubric-queue/${RUBRIC_DECISION}`);
    expect(screen.getByText(/La IA propone el nivel 1 · Parcial/)).toBeTruthy();
    expect(
      screen.getByText('Da la causa, pero no explica cómo provocó la inundación.'),
    ).toBeTruthy();
    const mark = document.querySelector('mark');
    expect(mark?.textContent).toBe('el río se desbordó');
    expect(screen.getByRole('button', { name: /Aprobar propuesta/ })).toBeTruthy();
    expect(screen.getByText('¿Por qué se inundó el pueblo?')).toBeTruthy();
  });

  it('nunca aprueba sin una acción explícita: Enter sin nivel elegido no hace nada', async () => {
    const { panel, onApprove } = await renderPanel();

    fireEvent.keyDown(panel, { key: 'Enter' });

    expect(onApprove).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Elige un nivel para aprobar/ })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('con una tecla de 0 a 9 elige el nivel y con Enter lo aprueba', async () => {
    const { panel, onApprove } = await renderPanel();

    fireEvent.keyDown(panel, { key: '2' });
    expect(
      screen.getByRole('button', { name: /Nivel 2 · Completa/ }).getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.keyDown(panel, { key: 'Enter' });

    expect(onApprove).toHaveBeenCalledWith(
      { decisionId: RUBRIC_DECISION, levelCode: '2' },
      'Pregunta 12: nivel 2 · Completa',
    );
  });

  it('A o el botón aprueban el nivel que propuso la IA', async () => {
    const { panel, onApprove } = await renderPanel();

    fireEvent.keyDown(panel, { key: 'a' });
    fireEvent.click(screen.getByRole('button', { name: /Aprobar propuesta/ }));

    expect(onApprove).toHaveBeenCalledTimes(2);
    expect((onApprove as jest.Mock).mock.calls[0][0]).toEqual({
      decisionId: RUBRIC_DECISION,
      levelCode: '1',
    });
  });

  it('sin propuesta no ofrece aprobarla', async () => {
    const { panel, onApprove } = await renderPanel(rubricDetail({ proposal: null }));

    expect(screen.queryByRole('button', { name: /Aprobar propuesta/ })).toBeNull();
    expect(screen.getByText(/No hay propuesta de la IA/)).toBeTruthy();
    fireEvent.keyDown(panel, { key: 'a' });
    expect(onApprove).not.toHaveBeenCalled();
    expect(document.querySelector('mark')).toBeNull();
  });

  it('antes de confirmar el lote no deja elegir ni aprobar', async () => {
    const { panel, onApprove } = await renderPanel(rubricDetail({ awaitingConfirmation: true }));

    expect(screen.getByText('Confirma el lote para calificar')).toBeTruthy();
    fireEvent.keyDown(panel, { key: '1' });
    fireEvent.keyDown(panel, { key: 'Enter' });
    fireEvent.keyDown(panel, { key: 'a' });

    expect(onApprove).not.toHaveBeenCalled();
  });

  it('las flechas recorren las respuestas y U deshace', async () => {
    const { panel, onNext, onPrev, onUndo } = await renderPanel(rubricDetail(), {
      canUndo: true,
    });

    fireEvent.keyDown(panel, { key: 'ArrowRight' });
    fireEvent.keyDown(panel, { key: 'ArrowLeft' });
    fireEvent.keyDown(panel, { key: 'u' });

    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });
});

describe('levelShortcuts', () => {
  const level = (code: string) => ({
    code,
    label: null,
    descriptor: null,
    creditFraction: 0,
    score: 0,
  });

  it('usa el código del nivel cuando es un dígito', () => {
    expect(levelShortcuts([level('0'), level('1'), level('2')]).map((entry) => entry.key)).toEqual([
      '0',
      '1',
      '2',
    ]);
  });

  it('si el código no es un dígito, usa la posición en la rúbrica', () => {
    expect(
      levelShortcuts([level('A'), level('B'), level('C')]).map((entry) => [
        entry.key,
        entry.level.code,
      ]),
    ).toEqual([
      ['0', 'A'],
      ['1', 'B'],
      ['2', 'C'],
    ]);
  });
});
