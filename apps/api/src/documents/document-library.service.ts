import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  documents,
  organizations,
  remedialMaterials,
  taxonomyNodes,
  users,
  withOrgContext,
  type Document,
} from '@soe/db';
import {
  isFeatureAllowed,
  LIBRARY_REMEDIAL_STATUSES,
  REMEDIAL_VIEWER_ROLES,
  userHasAnyRole,
  type MaterialLibraryItem,
  type MaterialLibraryQueryDto,
  type MaterialLibraryResponse,
  type MaterialRemedialRef,
} from '@soe/types';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { InjectDb, type Database } from '../database/database.types';
import { RemedialService } from '../remedial/remedial.service';
import { DocumentsService } from './documents.service';

type LibraryEntryKind = MaterialLibraryItem['kind'];

type LibraryEntry = { kind: LibraryEntryKind; id: string; updatedAt: Date };

type RemedialSummary = {
  id: string;
  type: MaterialRemedialRef['remedialType'];
  status: MaterialRemedialRef['status'];
  title: string | null;
  nodeId: string | null;
  nodeName: string | null;
  assessmentId: string | null;
  updatedAt: Date;
};

type DocumentWithAuthor = { document: Document; createdByName: string | null };

@Injectable()
export class DocumentLibraryService {
  constructor(
    @InjectDb() private readonly db: Database,
    private readonly documentsService: DocumentsService,
    private readonly remedialService: RemedialService,
  ) {}

  async list(user: JwtPayload, query: MaterialLibraryQueryDto): Promise<MaterialLibraryResponse> {
    const orgId = this.documentsService.requireOrgId(user);
    const { page, pageSize } = query;

    return withOrgContext(this.db, orgId, async (tx) => {
      const remedialAccess = await this.hasRemedialAccess(tx, user, orgId);
      const documentWhere = this.documentConditions(user, orgId, query, remedialAccess);
      const remedialWhere =
        remedialAccess && this.includesRemedials(query)
          ? await this.remedialConditions(tx, user, orgId, query)
          : null;

      const [entries, documentTotal, remedialTotal] = await Promise.all([
        this.pageEntries(tx, documentWhere, remedialWhere, page, pageSize),
        tx.select({ total: count() }).from(documents).where(documentWhere),
        remedialWhere
          ? tx.select({ total: count() }).from(remedialMaterials).where(remedialWhere)
          : Promise.resolve([{ total: 0 }]),
      ]);

      const data = await this.hydrate(tx, entries, remedialAccess);
      return {
        data,
        total: (documentTotal[0]?.total ?? 0) + (remedialTotal[0]?.total ?? 0),
        page,
        limit: pageSize,
      };
    });
  }

  private async hasRemedialAccess(tx: Database, user: JwtPayload, orgId: string): Promise<boolean> {
    if (user.isPlatformAdmin) return true;
    if (!userHasAnyRole(user.roles, REMEDIAL_VIEWER_ROLES)) return false;

    const [org] = await tx
      .select({ config: organizations.config })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    return isFeatureAllowed(org?.config, 'remedial');
  }

  private includesRemedials(query: MaterialLibraryQueryDto): boolean {
    if (query.type || query.status) return false;
    return !query.origin || query.origin === 'remedial';
  }

  private documentConditions(
    user: JwtPayload,
    orgId: string,
    query: MaterialLibraryQueryDto,
    remedialAccess: boolean,
  ): SQL | undefined {
    const conditions: Array<SQL | undefined> = [
      isNull(documents.deletedAt),
      this.documentsService.visibleCondition(orgId, user.userId),
    ];
    if (query.origin) conditions.push(sql`${documents.source}->>'kind' = ${query.origin}`);
    if (query.type) conditions.push(eq(documents.type, query.type));
    if (query.status) conditions.push(eq(documents.status, query.status));
    if (query.subjectId) conditions.push(eq(documents.subjectId, query.subjectId));
    if (query.gradeId) conditions.push(eq(documents.gradeId, query.gradeId));
    if (query.mine) conditions.push(eq(documents.createdById, user.userId));
    if (query.q) conditions.push(ilike(documents.title, `%${query.q}%`));
    if (query.review === 'pending_review') {
      conditions.push(
        remedialAccess
          ? sql`${documents.source}->>'kind' = 'remedial' and exists (select 1 from ${remedialMaterials} where ${remedialMaterials.id}::text = ${documents.source}->>'refId' and ${remedialMaterials.status} = 'ready' and ${remedialMaterials.deletedAt} is null)`
          : sql`false`,
      );
    }
    return and(...conditions);
  }

  private async remedialConditions(
    tx: Database,
    user: JwtPayload,
    orgId: string,
    query: MaterialLibraryQueryDto,
  ): Promise<SQL> {
    const visibleDocument = this.documentsService.visibleCondition(orgId, user.userId);
    const conditions: Array<SQL | undefined> = [
      eq(remedialMaterials.orgId, orgId),
      isNull(remedialMaterials.deletedAt),
      inArray(remedialMaterials.status, [...LIBRARY_REMEDIAL_STATUSES]),
      sql`not exists (select 1 from ${documents} where ${documents.source}->>'kind' = 'remedial' and ${documents.source}->>'refId' = ${remedialMaterials.id}::text and ${documents.deletedAt} is null and ${visibleDocument})`,
      await this.remedialService.scopeCondition(tx, user, orgId),
    ];
    if (query.review === 'pending_review') conditions.push(eq(remedialMaterials.status, 'ready'));
    if (query.mine) conditions.push(eq(remedialMaterials.createdById, user.userId));
    if (query.q) conditions.push(ilike(remedialMaterials.title, `%${query.q}%`));
    if (query.subjectId) {
      conditions.push(
        sql`exists (select 1 from ${taxonomyNodes} where ${taxonomyNodes.id} = ${remedialMaterials.nodeId} and ${taxonomyNodes.subjectId} = ${query.subjectId})`,
      );
    }
    if (query.gradeId) {
      conditions.push(
        sql`exists (select 1 from ${taxonomyNodes} where ${taxonomyNodes.id} = ${remedialMaterials.nodeId} and ${taxonomyNodes.gradeId} = ${query.gradeId})`,
      );
    }
    return and(...conditions) ?? sql`true`;
  }

  private async pageEntries(
    tx: Database,
    documentWhere: SQL | undefined,
    remedialWhere: SQL | null,
    page: number,
    pageSize: number,
  ): Promise<LibraryEntry[]> {
    const offset = (page - 1) * pageSize;
    const documentEntries = tx
      .select({
        kind: sql<LibraryEntryKind>`'document'`.as('kind'),
        id: documents.id,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(documentWhere);

    if (remedialWhere === null) {
      return documentEntries
        .orderBy(desc(documents.updatedAt), desc(documents.id))
        .limit(pageSize)
        .offset(offset);
    }

    const remedialEntries = tx
      .select({
        kind: sql<LibraryEntryKind>`'remedial'`.as('kind'),
        id: remedialMaterials.id,
        updatedAt: remedialMaterials.updatedAt,
      })
      .from(remedialMaterials)
      .where(remedialWhere);

    return documentEntries
      .unionAll(remedialEntries)
      .orderBy(desc(documents.updatedAt), desc(documents.id))
      .limit(pageSize)
      .offset(offset);
  }

  private async hydrate(
    tx: Database,
    entries: LibraryEntry[],
    remedialAccess: boolean,
  ): Promise<MaterialLibraryItem[]> {
    const documentIds: string[] = [];
    const remedialIds = new Set<string>();
    for (const entry of entries) {
      if (entry.kind === 'document') documentIds.push(entry.id);
      else remedialIds.add(entry.id);
    }

    const documentRows: DocumentWithAuthor[] =
      documentIds.length > 0
        ? await tx
            .select({ document: documents, createdByName: users.name })
            .from(documents)
            .leftJoin(users, eq(documents.createdById, users.id))
            .where(inArray(documents.id, documentIds))
        : [];

    if (remedialAccess) {
      for (const row of documentRows) {
        const { kind, refId } = row.document.source;
        if (kind === 'remedial' && refId) remedialIds.add(refId);
      }
    }

    const remedialRows: RemedialSummary[] =
      remedialIds.size > 0
        ? await tx
            .select({
              id: remedialMaterials.id,
              type: remedialMaterials.type,
              status: remedialMaterials.status,
              title: remedialMaterials.title,
              nodeId: remedialMaterials.nodeId,
              nodeName: taxonomyNodes.name,
              assessmentId: remedialMaterials.assessmentId,
              updatedAt: remedialMaterials.updatedAt,
            })
            .from(remedialMaterials)
            .leftJoin(taxonomyNodes, eq(remedialMaterials.nodeId, taxonomyNodes.id))
            .where(
              and(
                inArray(remedialMaterials.id, [...remedialIds]),
                isNull(remedialMaterials.deletedAt),
              ),
            )
        : [];

    const documentsById = new Map(documentRows.map((row) => [row.document.id, row]));
    const remedialsById = new Map(remedialRows.map((row) => [row.id, row]));

    const items: MaterialLibraryItem[] = [];
    for (const entry of entries) {
      if (entry.kind === 'document') {
        const row = documentsById.get(entry.id);
        if (row) items.push(this.toDocumentItem(row, remedialsById, remedialAccess));
        continue;
      }
      const remedial = remedialsById.get(entry.id);
      if (remedial) items.push(this.toRemedialItem(remedial));
    }
    return items;
  }

  private toDocumentItem(
    row: DocumentWithAuthor,
    remedialsById: Map<string, RemedialSummary>,
    remedialAccess: boolean,
  ): MaterialLibraryItem {
    const { source } = row.document;
    const linked =
      remedialAccess && source.kind === 'remedial' && source.refId
        ? remedialsById.get(source.refId)
        : undefined;
    return {
      kind: 'document',
      document: this.documentsService.toListItem(row.document, row.createdByName),
      origin: source.kind,
      remedial: linked ? this.toRemedialRef(linked) : null,
      updatedAt: row.document.updatedAt.toISOString(),
    };
  }

  private toRemedialItem(row: RemedialSummary): MaterialLibraryItem {
    return {
      kind: 'remedial',
      id: row.id,
      title: row.title ?? `Material remedial — ${row.nodeName ?? 'refuerzo'}`,
      origin: 'remedial',
      remedial: this.toRemedialRef(row),
      nodeId: row.nodeId,
      assessmentId: row.assessmentId,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toRemedialRef(row: RemedialSummary): MaterialRemedialRef {
    return { remedialMaterialId: row.id, remedialType: row.type, status: row.status };
  }
}
