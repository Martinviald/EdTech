import { BadRequestException, Injectable } from '@nestjs/common';
import { and, count, countDistinct, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { telemetryEvents, withOrgContext } from '@soe/db';
import type {
  TelemetryUsageGroupBy,
  TelemetryUsageQuery,
  TelemetryUsageResponse,
  TelemetryUsageRow,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';

@Injectable()
export class TelemetryUsageService {
  constructor(@InjectDb() private readonly db: Database) {}

  async getUsage(user: JwtPayload, query: TelemetryUsageQuery): Promise<TelemetryUsageResponse> {
    const orgId = user.orgId;
    if (!orgId) {
      throw new BadRequestException(
        'Se requiere una organización activa para consultar la telemetría de uso.',
      );
    }

    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;

    const conditions: SQL[] = [eq(telemetryEvents.orgId, orgId)];
    if (from) conditions.push(gte(telemetryEvents.createdAt, from));
    if (to) conditions.push(lte(telemetryEvents.createdAt, to));
    if (query.category) conditions.push(eq(telemetryEvents.eventCategory, query.category));
    const where = and(...conditions);

    const groupCol = TelemetryUsageService.groupColumn(query.groupBy);

    return withOrgContext(this.db, orgId, async (tx) => {
      const rows = await tx
        .select({
          key: groupCol,
          eventCount: count(),
          uniqueUsers: countDistinct(telemetryEvents.userId),
        })
        .from(telemetryEvents)
        .where(where)
        .groupBy(groupCol)
        .orderBy(desc(count()))
        .limit(query.limit);

      const [totals] = await tx
        .select({
          totalEvents: count(),
          uniqueUsers: countDistinct(telemetryEvents.userId),
        })
        .from(telemetryEvents)
        .where(where);

      const usageRows: TelemetryUsageRow[] = rows.map((row) => {
        const key = row.key == null ? '(desconocido)' : String(row.key);
        return {
          key,
          label: key,
          eventCount: Number(row.eventCount),
          uniqueUsers: Number(row.uniqueUsers),
        };
      });

      return {
        groupBy: query.groupBy,
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
        totalEvents: Number(totals?.totalEvents ?? 0),
        uniqueUsers: Number(totals?.uniqueUsers ?? 0),
        rows: usageRows,
      };
    });
  }

  private static groupColumn(groupBy: TelemetryUsageGroupBy): SQL<string | null> {
    switch (groupBy) {
      case 'category':
        return sql<string | null>`${telemetryEvents.eventCategory}`;
      case 'role':
        return sql<string | null>`${telemetryEvents.role}`;
      case 'day':
        return sql<string | null>`date_trunc('day', ${telemetryEvents.createdAt})::date::text`;
      case 'event':
      default:
        return sql<string | null>`${telemetryEvents.eventName}`;
    }
  }
}
