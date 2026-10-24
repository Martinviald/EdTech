import { Injectable } from '@nestjs/common';
import { and, eq, isNull, or } from 'drizzle-orm';
import {
  applyOrgRestrictions,
  resolveReadingRoute,
  type RestrictedRoute,
} from '@soe/answer-reading';
import { readingRoutes, withOrgContext, type ReadingRouteRow } from '@soe/db';
import {
  readingRouteSchema,
  type OrgAnswerReadingSettings,
  type ReadingContext,
  type ReadingRoute,
} from '@soe/types';
import { reportServerError } from '../common/observability/report-error';
import { InjectDb, type Database } from '../database/database.types';

export interface ReadingRouteCatalog {
  readonly routes: readonly ReadingRoute[];
  readonly shadowSampleRateById: ReadonlyMap<string, number>;
}

export type RouteForCrop = RestrictedRoute & { readonly shadowSampleRate: number };

@Injectable()
export class ReadingRoutesService {
  constructor(@InjectDb() private readonly db: Database) {}

  async loadCatalog(orgId: string): Promise<ReadingRouteCatalog> {
    const rows = await withOrgContext(this.db, orgId, (tx) =>
      tx
        .select()
        .from(readingRoutes)
        .where(
          and(
            eq(readingRoutes.status, 'active'),
            or(isNull(readingRoutes.orgId), eq(readingRoutes.orgId, orgId)),
          ),
        ),
    );
    const routes: ReadingRoute[] = [];
    const shadowSampleRateById = new Map<string, number>();
    for (const row of rows) {
      const route = this.parseRoute(orgId, row);
      if (route === null) continue;
      routes.push(route);
      shadowSampleRateById.set(route.id, route.shadowSampleRate);
    }
    return { routes, shadowSampleRateById };
  }

  resolve(
    context: ReadingContext,
    catalog: ReadingRouteCatalog,
    settings: OrgAnswerReadingSettings,
  ): RouteForCrop | null {
    const resolved = resolveReadingRoute(context, catalog.routes);
    if (resolved === null) return null;
    return {
      ...applyOrgRestrictions(resolved, settings),
      shadowSampleRate: catalog.shadowSampleRateById.get(resolved.routeId) ?? 0,
    };
  }

  private parseRoute(orgId: string, row: ReadingRouteRow): ReadingRoute | null {
    const parsed = readingRouteSchema.safeParse({
      id: row.id,
      version: row.version,
      orgId: row.orgId,
      status: row.status,
      level: row.level,
      itemId: row.itemId,
      instrumentId: row.instrumentId,
      formatKind: row.formatKind,
      subjectId: row.subjectId,
      gradeId: row.gradeId,
      readers: row.readers,
      fallbackReaders: row.fallbackReaders,
      shadowReaders: row.shadowReaders,
      shadowSampleRate: Number(row.shadowSampleRate),
      policy: row.policy,
    });
    if (parsed.success) return parsed.data;
    reportServerError(new Error('Ruta de lectura inválida: se ignora'), {
      orgId,
      routeId: row.id,
      issues: parsed.error.issues.map((issue) => issue.path.join('.')),
    });
    return null;
  }
}
