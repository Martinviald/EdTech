import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request, Response } from 'express';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { TelemetryService } from './telemetry.service';

const SKIP_PATH_SEGMENTS = ['/telemetry', '/health', '/mcp', '/.well-known'];

@Injectable()
export class TelemetryInterceptor implements NestInterceptor {
  private readonly enabled: boolean;
  private readonly sampleRate: number;

  constructor(private readonly telemetry: TelemetryService) {
    this.enabled = process.env.TELEMETRY_ENABLED !== 'false';
    this.sampleRate = TelemetryInterceptor.resolveSampleRate(
      process.env.TELEMETRY_API_SAMPLE_RATE,
    );
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.enabled || context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: JwtPayload }>();
    const response = http.getResponse<Response>();
    const user = request.user;

    if (!user?.orgId || this.shouldSkip(request) || Math.random() >= this.sampleRate) {
      return next.handle();
    }

    const actor = { orgId: user.orgId, userId: user.userId, role: user.activeRole ?? null };
    const start = Date.now();
    const emit = (status: number): void => {
      this.telemetry.trackServer(actor, 'api.request', {
        method: request.method,
        route: this.routeOf(request),
        status,
        durationMs: Date.now() - start,
      });
    };

    return next.handle().pipe(
      tap({
        next: () => emit(response.statusCode),
        error: (error: { status?: number }) =>
          emit(typeof error?.status === 'number' ? error.status : 500),
      }),
    );
  }

  private shouldSkip(request: Request): boolean {
    if (request.method === 'OPTIONS') return true;
    const url = request.originalUrl ?? request.url ?? '';
    return SKIP_PATH_SEGMENTS.some((segment) => url.includes(segment));
  }

  private routeOf(request: Request): string {
    const route = (request.route as { path?: string } | undefined)?.path;
    if (typeof route === 'string' && route.length > 0) {
      const base = typeof request.baseUrl === 'string' ? request.baseUrl : '';
      return `${base}${route}` || route;
    }
    const path = typeof request.path === 'string' ? request.path : request.url;
    return path.split('?')[0] ?? path;
  }

  private static resolveSampleRate(raw: string | undefined): number {
    if (raw === undefined || raw.trim() === '') return 1;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(Math.max(parsed, 0), 1);
  }
}
