import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { UserRole } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { RolesGuard } from '../common/guards/roles.guard';
import { AnswerReadingReviewQueueService } from './answer-reading-review-queue.service';
import { AnswerReadingReviewController } from './answer-reading-review.controller';
import { AnswerReadingReviewsService } from './answer-reading-reviews.service';

const DECISION_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const ASSESSMENT_ID = '44444444-4444-4444-8444-444444444444';
const RESULT = {
  reviewIds: [],
  appliedDecisionIds: [],
  skippedHumanScored: [],
  pendingConsolidation: [],
};

function userWith(roles: UserRole[]): JwtPayload {
  const [activeRole = 'teacher'] = roles;
  return {
    userId: 'user-1',
    orgId: 'org-1',
    email: 'revisora@colegio.cl',
    name: 'Revisora',
    isPlatformAdmin: false,
    roles,
    activeRole,
    role: activeRole,
  };
}

describe('AnswerReadingReviewController (HTTP)', () => {
  let app: INestApplication;
  let currentUser: JwtPayload = userWith(['eval_coordinator']);
  const queueService = {
    summary: jest.fn().mockResolvedValue({}),
    queue: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 }),
    detail: jest.fn().mockResolvedValue({}),
  };
  const reviewsService = {
    submit: jest.fn().mockResolvedValue(RESULT),
    undo: jest.fn().mockResolvedValue(RESULT),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AnswerReadingReviewController],
      providers: [
        RolesGuard,
        { provide: AnswerReadingReviewQueueService, useValue: queueService },
        { provide: AnswerReadingReviewsService, useValue: reviewsService },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.use((req: { user?: JwtPayload }, _res: unknown, next: () => void) => {
      req.user = currentUser;
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    currentUser = userWith(['eval_coordinator']);
  });

  it('un docente sin rol de revisión recibe 403 y el servicio no se llama', async () => {
    currentUser = userWith(['teacher']);

    const res = await request(app.getHttpServer()).get(
      `/answer-reading/queue?assessmentId=${ASSESSMENT_ID}`,
    );

    expect(res.status).toBe(403);
    expect(queueService.queue).not.toHaveBeenCalled();
  });

  it('la cola usa el orgId del token y convierte la paginación', async () => {
    const res = await request(app.getHttpServer()).get(
      `/answer-reading/queue?assessmentId=${ASSESSMENT_ID}&page=2&pageSize=5&includeAudit=true`,
    );

    expect(res.status).toBe(200);
    expect(queueService.queue).toHaveBeenCalledWith('org-1', {
      assessmentId: ASSESSMENT_ID,
      includeAudit: true,
      page: 2,
      pageSize: 5,
    });
  });

  it('un parámetro desconocido en la cola responde 400 (DTO estricto)', async () => {
    const res = await request(app.getHttpServer()).get(
      `/answer-reading/queue?assessmentId=${ASSESSMENT_ID}&limit=5`,
    );

    expect(res.status).toBe(400);
    expect(queueService.queue).not.toHaveBeenCalled();
  });

  it('el resumen exige una evaluación o un lote', async () => {
    const res = await request(app.getHttpServer()).get('/answer-reading/queue/summary');

    expect(res.status).toBe(400);
  });

  it('POST /reviews con un orgId en el cuerpo responde 400 (DTO estricto)', async () => {
    const res = await request(app.getHttpServer())
      .post('/answer-reading/reviews')
      .send({ decisionIds: [DECISION_ID], mode: 'reading', action: 'accept', orgId: 'otra' });

    expect(res.status).toBe(400);
    expect(reviewsService.submit).not.toHaveBeenCalled();
  });

  it('POST /reviews con una acción de otro modo responde 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/answer-reading/reviews')
      .send({ decisionIds: [DECISION_ID], mode: 'reading', action: 'mark_correct' });

    expect(res.status).toBe(400);
    expect(reviewsService.submit).not.toHaveBeenCalled();
  });

  it('POST /reviews válido pasa org y revisor del token', async () => {
    const res = await request(app.getHttpServer())
      .post('/answer-reading/reviews')
      .send({ decisionIds: [DECISION_ID], mode: 'reading', action: 'edit', editedLiteral: '7' });

    expect(res.status).toBe(201);
    expect(reviewsService.submit).toHaveBeenCalledWith('org-1', 'user-1', {
      decisionIds: [DECISION_ID],
      mode: 'reading',
      action: 'edit',
      editedLiteral: '7',
    });
  });

  it('POST /reviews/undo valida el lote y usa el token', async () => {
    const res = await request(app.getHttpServer())
      .post('/answer-reading/reviews/undo')
      .send({ reviewIds: [DECISION_ID] });

    expect(res.status).toBe(201);
    expect(reviewsService.undo).toHaveBeenCalledWith('org-1', 'user-1', {
      reviewIds: [DECISION_ID],
    });
  });

  it('GET /decisions/:id rechaza un id que no es uuid', async () => {
    const res = await request(app.getHttpServer()).get('/answer-reading/decisions/abc');

    expect(res.status).toBe(400);
    expect(queueService.detail).not.toHaveBeenCalled();
  });
});
