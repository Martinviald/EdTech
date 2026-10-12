import { NotFoundException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { UserRole } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { RolesGuard } from '../common/guards/roles.guard';
import { RubricReviewController } from './rubric-review.controller';
import { RubricReviewService } from './rubric-review.service';

const DECISION_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const ASSESSMENT_ID = '44444444-4444-4444-8444-444444444444';
const RESULT = { reviewIds: [], approvedDecisionIds: [], skipped: [] };

function userWith(roles: UserRole[], orgId = 'org-1'): JwtPayload {
  const [activeRole = 'teacher'] = roles;
  return {
    userId: 'user-1',
    orgId,
    email: 'revisora@colegio.cl',
    name: 'Revisora',
    isPlatformAdmin: false,
    roles,
    activeRole,
    role: activeRole,
  };
}

describe('RubricReviewController (HTTP)', () => {
  let app: INestApplication;
  let currentUser: JwtPayload = userWith(['eval_coordinator']);
  const service = {
    queue: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 20 }),
    detail: jest.fn().mockResolvedValue({}),
    approve: jest.fn().mockResolvedValue(RESULT),
    acceptProposals: jest.fn().mockResolvedValue(RESULT),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [RubricReviewController],
      providers: [RolesGuard, { provide: RubricReviewService, useValue: service }],
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

  it('un docente sin rol de revisión recibe 403 en la cola y en la aprobación', async () => {
    currentUser = userWith(['teacher']);

    const queue = await request(app.getHttpServer()).get(
      `/answer-reading/rubric-queue?assessmentId=${ASSESSMENT_ID}`,
    );
    const approval = await request(app.getHttpServer())
      .post('/answer-reading/rubric-approvals')
      .send({ decisionId: DECISION_ID, levelCode: '2' });

    expect(queue.status).toBe(403);
    expect(approval.status).toBe(403);
    expect(service.queue).not.toHaveBeenCalled();
    expect(service.approve).not.toHaveBeenCalled();
  });

  it('la cola usa el orgId del token y convierte la paginación', async () => {
    const res = await request(app.getHttpServer()).get(
      `/answer-reading/rubric-queue?batchId=${ASSESSMENT_ID}&page=2&pageSize=5`,
    );

    expect(res.status).toBe(200);
    expect(service.queue).toHaveBeenCalledWith('org-1', {
      batchId: ASSESSMENT_ID,
      page: 2,
      pageSize: 5,
    });
  });

  it('la cola rechaza parámetros desconocidos', async () => {
    const res = await request(app.getHttpServer()).get(
      `/answer-reading/rubric-queue?assessmentId=${ASSESSMENT_ID}&orgId=otra`,
    );

    expect(res.status).toBe(400);
    expect(service.queue).not.toHaveBeenCalled();
  });

  it('el detalle rechaza un id que no es uuid y responde 404 si es de otra organización', async () => {
    const invalid = await request(app.getHttpServer()).get('/answer-reading/rubric-queue/abc');
    expect(invalid.status).toBe(400);

    currentUser = userWith(['eval_coordinator'], 'org-2');
    service.detail.mockRejectedValueOnce(new NotFoundException('No encontramos esa respuesta'));
    const foreign = await request(app.getHttpServer()).get(
      `/answer-reading/rubric-queue/${DECISION_ID}`,
    );

    expect(foreign.status).toBe(404);
    expect(service.detail).toHaveBeenCalledWith('org-2', DECISION_ID);
  });

  it('POST /rubric-approvals con un campo de más responde 400 (DTO estricto)', async () => {
    const res = await request(app.getHttpServer())
      .post('/answer-reading/rubric-approvals')
      .send({ decisionId: DECISION_ID, levelCode: '2', orgId: 'otra' });

    expect(res.status).toBe(400);
    expect(service.approve).not.toHaveBeenCalled();
  });

  it('POST /rubric-approvals válido pasa org y revisor del token', async () => {
    const res = await request(app.getHttpServer())
      .post('/answer-reading/rubric-approvals')
      .send({ decisionId: DECISION_ID, levelCode: '2', reason: 'Explica la causa' });

    expect(res.status).toBe(201);
    expect(service.approve).toHaveBeenCalledWith('org-1', 'user-1', {
      decisionId: DECISION_ID,
      levelCode: '2',
      reason: 'Explica la causa',
    });
  });

  it('aceptar propuestas no admite un nivel común para todas', async () => {
    const invalid = await request(app.getHttpServer())
      .post('/answer-reading/rubric-approvals/accept-proposals')
      .send({ acceptAiProposals: [DECISION_ID], levelCode: '2' });
    const valid = await request(app.getHttpServer())
      .post('/answer-reading/rubric-approvals/accept-proposals')
      .send({ acceptAiProposals: [DECISION_ID] });

    expect(invalid.status).toBe(400);
    expect(valid.status).toBe(201);
    expect(service.acceptProposals).toHaveBeenCalledTimes(1);
    expect(service.acceptProposals).toHaveBeenCalledWith('org-1', 'user-1', {
      acceptAiProposals: [DECISION_ID],
    });
  });
});
