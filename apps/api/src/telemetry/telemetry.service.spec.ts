import type { IngestTelemetryDto } from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { TelemetryService } from './telemetry.service';
import type { TelemetryWriterService } from './telemetry-writer.service';
import type { TelemetryRecord } from './telemetry.types';

function makeUser(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    userId: 'user-1',
    orgId: 'org-1',
    email: 'a@b.cl',
    name: 'Ada',
    isPlatformAdmin: false,
    roles: ['teacher'],
    activeRole: 'teacher',
    role: 'teacher',
    ...overrides,
  };
}

function makeService(): { service: TelemetryService; records: TelemetryRecord[] } {
  const records: TelemetryRecord[] = [];
  const writer = {
    record: (event: TelemetryRecord) => records.push(event),
  } as unknown as TelemetryWriterService;
  return { service: new TelemetryService(writer), records };
}

describe('TelemetryService.ingestFromClient', () => {
  it('records valid events attributing org/user from the JWT, never the payload', () => {
    const { service, records } = makeService();
    const dto: IngestTelemetryDto = {
      events: [
        { name: 'page.viewed', properties: { path: '/resultados', section: 'resultados' } },
        {
          name: 'export.generated',
          properties: { format: 'pdf', surface: 'Heatmap', rowCount: 12 },
        },
      ],
    };

    const result = service.ingestFromClient(makeUser(), dto);

    expect(result).toEqual({ accepted: 2, rejected: 0 });
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      orgId: 'org-1',
      userId: 'user-1',
      eventName: 'page.viewed',
      eventCategory: 'navigation',
      role: 'teacher',
    });
    expect(records[1]).toMatchObject({ eventName: 'export.generated', eventCategory: 'results' });
  });

  it('drops unknown event names and invalid properties without throwing', () => {
    const { service, records } = makeService();
    const dto: IngestTelemetryDto = {
      events: [
        { name: 'does.not.exist', properties: {} },
        { name: 'export.generated', properties: { format: 'docx', surface: 'x' } },
        { name: 'page.viewed', properties: { path: '/ok' } },
      ],
    };

    const result = service.ingestFromClient(makeUser(), dto);

    expect(result).toEqual({ accepted: 1, rejected: 2 });
    expect(records).toHaveLength(1);
    expect(records[0]?.eventName).toBe('page.viewed');
  });

  it('persists nothing for an actor without an active org (cannot attribute to a tenant)', () => {
    const { service, records } = makeService();
    const dto: IngestTelemetryDto = {
      events: [{ name: 'page.viewed', properties: { path: '/x' } }],
    };

    const result = service.ingestFromClient(makeUser({ orgId: null }), dto);

    expect(result).toEqual({ accepted: 0, rejected: 1 });
    expect(records).toHaveLength(0);
  });
});

describe('TelemetryService.trackServer', () => {
  it('records a typed server event with source "api"', () => {
    const { service, records } = makeService();

    service.trackServer(
      { orgId: 'org-9', userId: 'user-9', role: 'school_admin' },
      'api.request',
      { method: 'GET', route: '/api/students', status: 200, durationMs: 5 },
    );

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      orgId: 'org-9',
      eventName: 'api.request',
      eventCategory: 'system',
      source: 'api',
      role: 'school_admin',
    });
  });

  it('skips events for an actor without org', () => {
    const { service, records } = makeService();

    service.trackServer({ orgId: null, userId: null, role: null }, 'api.request', {
      method: 'GET',
      route: '/api/health',
      status: 200,
      durationMs: 1,
    });

    expect(records).toHaveLength(0);
  });
});
