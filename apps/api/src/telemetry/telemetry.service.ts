import { Injectable } from '@nestjs/common';
import {
  parseTelemetryEvent,
  type IngestTelemetryDto,
  type IngestTelemetryResponse,
  type TelemetryContext,
  type TelemetryEventName,
  type TelemetryEventPropertiesMap,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { TelemetryWriterService } from './telemetry-writer.service';
import type { TelemetryActor } from './telemetry.types';

@Injectable()
export class TelemetryService {
  constructor(private readonly writer: TelemetryWriterService) {}

  ingestFromClient(user: JwtPayload, dto: IngestTelemetryDto): IngestTelemetryResponse {
    const orgId = user.orgId;
    if (!orgId) return { accepted: 0, rejected: dto.events.length };

    let accepted = 0;
    for (const input of dto.events) {
      const validated = parseTelemetryEvent(input.name, input.properties);
      if (!validated) continue;
      this.writer.record({
        orgId,
        userId: user.userId,
        eventName: validated.name,
        eventCategory: validated.category,
        source: input.context?.source ?? 'web',
        role: user.activeRole ?? null,
        properties: validated.properties,
        context: input.context ?? {},
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      });
      accepted += 1;
    }

    return { accepted, rejected: dto.events.length - accepted };
  }

  trackServer<K extends TelemetryEventName>(
    actor: TelemetryActor,
    name: K,
    properties: TelemetryEventPropertiesMap[K],
    context: TelemetryContext = {},
  ): void {
    if (!actor.orgId) return;
    const validated = parseTelemetryEvent(name, properties);
    if (!validated) return;
    this.writer.record({
      orgId: actor.orgId,
      userId: actor.userId,
      eventName: validated.name,
      eventCategory: validated.category,
      source: 'api',
      role: actor.role,
      properties: validated.properties,
      context,
      occurredAt: new Date(),
    });
  }
}
