import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { RolesGuard } from '../common/guards/roles.guard';
import { FeatureGuard } from '../common/guards/feature.guard';
import type { AgentStreamEvent } from '../llm/llm-agent.service';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

// ──────────────────────────────────────────────────────────────────────────────
// Test de integración del controller (e2e-lite): NO toca DB ni LLM. Stubea
// AssistantService y desactiva los guards, para verificar el contrato HTTP y el
// STREAMING SSE escrito a mano (la pieza sin precedente en el repo). El usuario
// del JWT se inyecta vía un guard global de prueba.
// ──────────────────────────────────────────────────────────────────────────────

const USER: JwtPayload = {
  userId: 'user-1',
  orgId: 'org-1',
  email: 'dir@colegio.cl',
  name: 'Dir',
  isPlatformAdmin: false,
  roles: ['school_admin'],
  activeRole: 'school_admin',
  role: 'school_admin',
};

const allowAll = { canActivate: () => true };

describe('AssistantController (integración HTTP + SSE)', () => {
  let app: INestApplication;
  const service = {
    createConversation: jest.fn(),
    listConversations: jest.fn(),
    getConversation: jest.fn(),
    deleteConversation: jest.fn(),
    searchStudents: jest.fn(),
    streamReply: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AssistantController],
      providers: [
        { provide: AssistantService, useValue: service },
        {
          // Simula al AuthGuard: adjunta el JWT al request.
          provide: APP_GUARD,
          useValue: {
            canActivate: (ctx: {
              switchToHttp: () => { getRequest: () => { user?: JwtPayload } };
            }) => {
              ctx.switchToHttp().getRequest().user = USER;
              return true;
            },
          },
        },
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue(allowAll)
      .overrideGuard(FeatureGuard)
      .useValue(allowAll)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it('POST /assistant/conversations crea un hilo y pasa el JWT al service', async () => {
    service.createConversation.mockResolvedValue({
      id: 'conv-1',
      title: 'Hola',
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    });

    const res = await request(app.getHttpServer())
      .post('/assistant/conversations')
      .send({ title: 'Hola' })
      .expect(201);

    expect(res.body.id).toBe('conv-1');
    expect(service.createConversation).toHaveBeenCalledWith(USER, { title: 'Hola' });
  });

  it('POST /conversations/:id/messages emite SSE y NO reenvía el evento final', async () => {
    const events: AgentStreamEvent[] = [
      { type: 'text_delta', text: 'Hola ' },
      { type: 'tool_call', id: 't1', name: 'get_heatmap', input: {} },
      { type: 'tool_result', id: 't1', name: 'get_heatmap', isError: false },
      { type: 'text_delta', text: 'mundo.' },
      {
        type: 'final',
        text: 'Hola mundo.',
        usage: { inputTokens: 1, outputTokens: 1 },
        steps: 1,
        truncated: false,
        messages: [],
      },
    ];
    service.streamReply.mockImplementation(async function* () {
      for (const ev of events) yield ev;
    });

    const res = await request(app.getHttpServer())
      .post('/assistant/conversations/conv-1/messages')
      .send({ content: 'hola' })
      .expect(201)
      .expect('Content-Type', /text\/event-stream/);

    const body = res.text;
    expect(body).toContain('data: {"type":"text_delta","text":"Hola "}');
    expect(body).toContain('"type":"tool_call"');
    expect(body).toContain('"type":"tool_result"');
    expect(body).toContain('data: {"type":"done"}');
    // El evento final NO se reenvía (la persistencia ocurre en el service).
    expect(body).not.toContain('"type":"final"');
    expect(service.streamReply).toHaveBeenCalledWith(USER, 'conv-1', {
      content: 'hola',
    });
  });

  it('si el stream lanza, emite un frame de error dentro del SSE (200)', async () => {
    service.streamReply.mockImplementation(async function* () {
      yield { type: 'text_delta', text: 'parcial' } as AgentStreamEvent;
      throw new Error('boom interno');
    });

    const res = await request(app.getHttpServer())
      .post('/assistant/conversations/conv-1/messages')
      .send({ content: 'hola' })
      .expect(201);

    expect(res.text).toContain('"type":"text_delta"');
    expect(res.text).toContain('"type":"error"');
    expect(res.text).toContain('boom interno');
  });

  it('GET /assistant/students?q= devuelve { data } del service', async () => {
    service.searchStudents.mockResolvedValue([{ id: 'st-1', fullName: 'Ana Pérez' }]);

    const res = await request(app.getHttpServer()).get('/assistant/students?q=ana').expect(200);

    expect(res.body).toEqual({ data: [{ id: 'st-1', fullName: 'Ana Pérez' }] });
    expect(service.searchStudents).toHaveBeenCalledWith(USER, { q: 'ana', limit: 10 });
  });

  it('DELETE /assistant/conversations/:id responde 204', async () => {
    service.deleteConversation.mockResolvedValue(undefined);

    await request(app.getHttpServer()).delete('/assistant/conversations/conv-1').expect(204);

    expect(service.deleteConversation).toHaveBeenCalledWith(USER, 'conv-1');
  });
});
