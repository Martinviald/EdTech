import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { telemetryEvents, withOrgContext } from '@soe/db';
import { InjectDb, type Database } from '../database/database.types';
import type { TelemetryRecord } from './telemetry.types';

const DEFAULT_BUFFER_SIZE = 200;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;

@Injectable()
export class TelemetryWriterService implements OnModuleDestroy {
  private readonly logger = new Logger(TelemetryWriterService.name);
  private readonly maxBufferSize: number;
  private readonly flushIntervalMs: number;
  private buffer: TelemetryRecord[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;

  constructor(@InjectDb() private readonly db: Database) {
    this.maxBufferSize = TelemetryWriterService.resolvePositiveInt(
      process.env.TELEMETRY_BUFFER_SIZE,
      DEFAULT_BUFFER_SIZE,
    );
    this.flushIntervalMs = TelemetryWriterService.resolvePositiveInt(
      process.env.TELEMETRY_FLUSH_MS,
      DEFAULT_FLUSH_INTERVAL_MS,
    );
  }

  record(event: TelemetryRecord): void {
    this.buffer.push(event);
    if (this.buffer.length >= this.maxBufferSize) {
      void this.flush();
      return;
    }
    this.ensureTimer();
  }

  async onModuleDestroy(): Promise<void> {
    await this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;
    const batch = this.buffer;
    this.buffer = [];
    this.clearTimer();
    try {
      await this.persist(batch);
    } catch (error) {
      this.logger.error(
        `No se pudo persistir un lote de ${batch.length} eventos de telemetría: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.flushing = false;
      if (this.buffer.length > 0) this.ensureTimer();
    }
  }

  private async persist(batch: TelemetryRecord[]): Promise<void> {
    const byOrg = new Map<string, TelemetryRecord[]>();
    for (const event of batch) {
      const existing = byOrg.get(event.orgId);
      if (existing) existing.push(event);
      else byOrg.set(event.orgId, [event]);
    }

    for (const [orgId, events] of byOrg) {
      await withOrgContext(this.db, orgId, async (tx) => {
        await tx.insert(telemetryEvents).values(
          events.map((event) => ({
            orgId: event.orgId,
            userId: event.userId,
            eventName: event.eventName,
            eventCategory: event.eventCategory,
            source: event.source,
            role: event.role,
            properties: event.properties,
            context: event.context,
            occurredAt: event.occurredAt,
          })),
        );
      });
    }
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.flushIntervalMs);
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private static resolvePositiveInt(raw: string | undefined, fallback: number): number {
    if (raw === undefined || raw.trim() === '') return fallback;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }
}
