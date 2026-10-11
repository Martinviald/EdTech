import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ReviewQueuePage, SubmitReviewResult } from '@soe/types';
import { apiClientGet, apiClientPost } from '@/lib/api-client';
import { WrittenAnswersReview } from './WrittenAnswersReview';
import {
  DECISION_A,
  DECISION_B,
  DECISION_C,
  REVIEW_A,
  readingGroup,
  summary,
} from './test-fixtures';

jest.mock('@/lib/api-client', () => ({
  apiClientGet: jest.fn(),
  apiClientPost: jest.fn(),
}));

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), warning: jest.fn(), success: jest.fn() },
}));

const getMock = apiClientGet as jest.MockedFunction<typeof apiClientGet>;
const postMock = apiClientPost as jest.MockedFunction<typeof apiClientPost>;
const BATCH_ID = '55555555-5555-4555-8555-555555555555';

const SMALL_GROUP = readingGroup({
  groupKey: 'small',
  printedNumber: '9',
  size: 1,
  members: [{ decisionId: '66666666-6666-4666-8666-666666666666', cropUrl: null, isAudit: false }],
});

function queuePage(groups = [SMALL_GROUP, readingGroup()]): ReviewQueuePage {
  return { data: groups, total: groups.length, page: 1, limit: 50 };
}

function result(overrides: Partial<SubmitReviewResult> = {}): SubmitReviewResult {
  return {
    reviewIds: [REVIEW_A],
    appliedDecisionIds: [DECISION_A, DECISION_B, DECISION_C],
    skippedHumanScored: [],
    pendingConsolidation: [],
    ...overrides,
  };
}

function renderReview() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WrittenAnswersReview scope={{ batchId: BATCH_ID }} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getMock.mockImplementation((path: string) =>
    Promise.resolve(path.startsWith('/answer-reading/queue/summary') ? summary() : queuePage()),
  );
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe('WrittenAnswersReview', () => {
  it('pide la cola del lote en modo lectura y muestra primero el grupo más grande', async () => {
    renderReview();
    await screen.findByRole('group', { name: /Grupo 1 de 2: pregunta 7, 3 respuestas/ });
    expect(getMock).toHaveBeenCalledWith(`/answer-reading/queue/summary?batchId=${BATCH_ID}`);
    expect(getMock).toHaveBeenCalledWith(
      `/answer-reading/queue?batchId=${BATCH_ID}&mode=reading&page=1&pageSize=50`,
    );
  });

  it('envía la revisión, saca el grupo de la cola y avisa lo que ya tenía corrección humana', async () => {
    postMock.mockResolvedValueOnce(result({ skippedHumanScored: [DECISION_B] }));
    renderReview();
    const panel = await screen.findByRole('group', { name: /pregunta 7/ });

    fireEvent.keyDown(panel, { key: 'a' });

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/answer-reading/reviews', {
        decisionIds: [DECISION_A, DECISION_B, DECISION_C],
        mode: 'reading',
        action: 'accept',
      }),
    );
    await waitFor(() =>
      expect(toast.warning).toHaveBeenCalledWith(
        'Una respuesta ya tenía corrección humana; no se cambió.',
      ),
    );
    expect(await screen.findByRole('group', { name: /Grupo 1 de 1: pregunta 9/ })).toBeTruthy();
  });

  it('deshace la última acción de grupo con U', async () => {
    postMock.mockResolvedValue(result());
    renderReview();
    const panel = await screen.findByRole('group', { name: /pregunta 7/ });
    fireEvent.keyDown(panel, { key: 'b' });
    const next = await screen.findByRole('group', { name: /pregunta 9/ });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('En blanco'));

    await act(async () => {
      fireEvent.keyDown(next, { key: 'u' });
    });

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/answer-reading/reviews/undo', {
        reviewIds: [REVIEW_A],
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Se deshizo: En blanco'),
    );
  });

  it('avisa cuando todavía hay respuestas en lectura', async () => {
    getMock.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith('/answer-reading/queue/summary')
          ? summary({ inProgress: 4 })
          : queuePage([]),
      ),
    );
    renderReview();
    expect(await screen.findByText('Todavía se están leyendo respuestas')).toBeTruthy();
    expect(await screen.findByText('Las respuestas se están leyendo')).toBeTruthy();
  });
});
