import { Injectable } from '@nestjs/common';
import { and, count, countDistinct, desc, eq, gte, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { organizations, telemetryEvents, users, withOrgContext } from '@soe/db';
import type {
  TelemetryDimensionRow,
  TelemetryOrgUsageResponse,
  TelemetryPlatformOverviewResponse,
  TelemetryUsageFilters,
  TelemetryUserUsageRow,
} from '@soe/types';
import { InjectDb, type Database } from '../database/database.types';

const BACKEND_MODULE_KEY = sql<string | null>`split_part(ltrim(${telemetryEvents.properties} ->> 'route', '/'), '/', 2)`;
const FRONTEND_VIEW_KEY = sql<string | null>`${telemetryEvents.properties} ->> 'section'`;
const MCP_TOOL_KEY = sql<string | null>`${telemetryEvents.properties} ->> 'tool'`;
const CATEGORY_KEY = sql<string | null>`${telemetryEvents.eventCategory}`;

@Injectable()
export class TelemetryReportService {
  constructor(@InjectDb() private readonly db: Database) {}

  async getOrgUsage(orgId: string, filters: TelemetryUsageFilters): Promise<TelemetryOrgUsageResponse> {
    const from = filters.from ? new Date(filters.from) : null;
    const to = filters.to ? new Date(filters.to) : null;
    const orgName = await this.orgName(orgId);

    return withOrgContext(this.db, orgId, async (tx) => {
      const [totals] = await tx
        .select({ events: count(), uniqueUsers: countDistinct(telemetryEvents.userId) })
        .from(telemetryEvents)
        .where(this.scope(orgId, from, to));

      const byUser = await this.userBreakdown(tx, orgId, from, to);
      const byBackendModule = await this.dimension(tx, orgId, from, to, BACKEND_MODULE_KEY, 'api.request');
      const byFrontendView = await this.dimension(tx, orgId, from, to, FRONTEND_VIEW_KEY, 'page.viewed');
      const byMcpTool = await this.dimension(tx, orgId, from, to, MCP_TOOL_KEY, 'mcp.tool_invoked');
      const byCategory = await this.dimension(tx, orgId, from, to, CATEGORY_KEY);

      return {
        orgId,
        orgName,
        from: from ? from.toISOString() : null,
        to: to ? to.toISOString() : null,
        totalEvents: Number(totals?.events ?? 0),
        uniqueUsers: Number(totals?.uniqueUsers ?? 0),
        byUser,
        byBackendModule,
        byFrontendView,
        byMcpTool,
        byCategory,
      };
    });
  }

  async getPlatformOverview(
    filters: TelemetryUsageFilters,
  ): Promise<TelemetryPlatformOverviewResponse> {
    const from = filters.from ? new Date(filters.from) : null;
    const to = filters.to ? new Date(filters.to) : null;

    const orgs = await this.db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(isNull(organizations.deletedAt));

    const byOrg: TelemetryPlatformOverviewResponse['byOrg'] = [];
    const userSet = new Set<string>();
    const modules = new Map<string, { events: number; users: number }>();
    const views = new Map<string, { events: number; users: number }>();
    let totalEvents = 0;

    for (const org of orgs) {
      const result = await withOrgContext(this.db, org.id, async (tx) => {
        const [totals] = await tx
          .select({
            events: count(),
            userIds: sql<
              string[]
            >`coalesce(array_agg(distinct ${telemetryEvents.userId}) filter (where ${telemetryEvents.userId} is not null), '{}')`,
            lastSeen: sql<string | null>`max(${telemetryEvents.occurredAt})::text`,
          })
          .from(telemetryEvents)
          .where(this.scope(org.id, from, to));

        const mods = await this.dimension(tx, org.id, from, to, BACKEND_MODULE_KEY, 'api.request');
        const vws = await this.dimension(tx, org.id, from, to, FRONTEND_VIEW_KEY, 'page.viewed');
        return {
          events: Number(totals?.events ?? 0),
          userIds: totals?.userIds ?? [],
          lastSeen: totals?.lastSeen ?? null,
          mods,
          vws,
        };
      });

      if (result.events === 0) continue;
      totalEvents += result.events;
      for (const id of result.userIds) userSet.add(id);
      byOrg.push({
        orgId: org.id,
        orgName: org.name,
        events: result.events,
        users: result.userIds.length,
        lastSeen: result.lastSeen,
      });
      TelemetryReportService.mergeDimensions(modules, result.mods);
      TelemetryReportService.mergeDimensions(views, result.vws);
    }

    byOrg.sort((a, b) => b.events - a.events);

    return {
      from: from ? from.toISOString() : null,
      to: to ? to.toISOString() : null,
      totalEvents,
      uniqueUsers: userSet.size,
      orgCount: byOrg.length,
      byOrg,
      byBackendModule: TelemetryReportService.dimensionsFromMap(modules),
      byFrontendView: TelemetryReportService.dimensionsFromMap(views),
    };
  }

  private scope(orgId: string, from: Date | null, to: Date | null): SQL {
    const conds: SQL[] = [eq(telemetryEvents.orgId, orgId)];
    if (from) conds.push(gte(telemetryEvents.createdAt, from));
    if (to) conds.push(lte(telemetryEvents.createdAt, to));
    return and(...conds) as SQL;
  }

  private async orgName(orgId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    return row?.name ?? null;
  }

  private async dimension(
    tx: Database,
    orgId: string,
    from: Date | null,
    to: Date | null,
    keyExpr: SQL<string | null>,
    eventName?: string,
  ): Promise<TelemetryDimensionRow[]> {
    const conds: SQL[] = [eq(telemetryEvents.orgId, orgId)];
    if (from) conds.push(gte(telemetryEvents.createdAt, from));
    if (to) conds.push(lte(telemetryEvents.createdAt, to));
    if (eventName) conds.push(eq(telemetryEvents.eventName, eventName));

    const rows = await tx
      .select({ key: keyExpr, events: count(), users: countDistinct(telemetryEvents.userId) })
      .from(telemetryEvents)
      .where(and(...conds))
      .groupBy(keyExpr)
      .orderBy(desc(count()));

    return rows.map((row) => {
      const key = row.key == null || row.key === '' ? '(desconocido)' : String(row.key);
      return { key, label: key, events: Number(row.events), users: Number(row.users) };
    });
  }

  private async userBreakdown(
    tx: Database,
    orgId: string,
    from: Date | null,
    to: Date | null,
  ): Promise<TelemetryUserUsageRow[]> {
    const conds: SQL[] = [eq(telemetryEvents.orgId, orgId)];
    if (from) conds.push(gte(telemetryEvents.createdAt, from));
    if (to) conds.push(lte(telemetryEvents.createdAt, to));

    const rows = await tx
      .select({
        userId: telemetryEvents.userId,
        name: users.name,
        email: users.email,
        events: count(),
        pageViews: sql<number>`count(*) filter (where ${telemetryEvents.eventName} = 'page.viewed')`,
        apiCalls: sql<number>`count(*) filter (where ${telemetryEvents.eventName} = 'api.request')`,
        mcpCalls: sql<number>`count(*) filter (where ${telemetryEvents.eventName} = 'mcp.tool_invoked')`,
        role: sql<string | null>`max(${telemetryEvents.role})`,
        lastSeen: sql<string | null>`max(${telemetryEvents.occurredAt})::text`,
      })
      .from(telemetryEvents)
      .leftJoin(users, eq(users.id, telemetryEvents.userId))
      .where(and(...conds))
      .groupBy(telemetryEvents.userId, users.name, users.email)
      .orderBy(desc(count()));

    return rows.map((row) => ({
      userId: row.userId ?? null,
      name: row.name ?? null,
      email: row.email ?? null,
      role: row.role ?? null,
      events: Number(row.events),
      pageViews: Number(row.pageViews),
      apiCalls: Number(row.apiCalls),
      mcpCalls: Number(row.mcpCalls),
      lastSeen: row.lastSeen ?? null,
    }));
  }

  private static mergeDimensions(
    acc: Map<string, { events: number; users: number }>,
    rows: TelemetryDimensionRow[],
  ): void {
    for (const row of rows) {
      const current = acc.get(row.key) ?? { events: 0, users: 0 };
      current.events += row.events;
      current.users += row.users;
      acc.set(row.key, current);
    }
  }

  private static dimensionsFromMap(
    acc: Map<string, { events: number; users: number }>,
  ): TelemetryDimensionRow[] {
    return Array.from(acc.entries())
      .map(([key, value]) => ({ key, label: key, events: value.events, users: value.users }))
      .sort((a, b) => b.events - a.events);
  }
}
