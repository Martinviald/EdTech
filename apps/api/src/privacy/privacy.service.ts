import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { desc, eq } from 'drizzle-orm';
import { auditLogs, students, withOrgContext } from '@soe/db';
import { InjectDb, type Database } from '../database/database.types';

/**
 * Lógica de privacidad y cumplimiento Ley 19.628:
 *  - Anonimización de alumnos (Derecho al Olvido, Art. 12).
 *  - Registro de auditoría de operaciones sensibles y exportaciones masivas.
 */
@Injectable()
export class PrivacyService {
  constructor(@InjectDb() private readonly db: Database) {}

  // ── Derecho al Olvido (Art. 12, Ley 19.628) ──────────────────────

  /**
   * Anonimiza de forma irreversible el PII de un alumno. Idempotente: si el
   * alumno ya está anonimizado, no hace nada. Los datos estadísticos
   * (responses, assessment_results, skill_results) se conservan intactos —
   * quedan anónimos por diseño al eliminarse el PII del alumno.
   */
  async anonymizeStudent(
    studentId: string,
    requestedBy: { userId: string; orgId: string | null; isPlatformAdmin: boolean },
  ): Promise<void> {
    // platform_admin sin orgId target: necesitamos resolverlo desde el alumno.
    let targetOrgId = requestedBy.orgId;
    if (!targetOrgId) {
      const [s] = await this.db
        .select({ orgId: students.orgId })
        .from(students)
        .where(eq(students.id, studentId));
      if (!s) throw new NotFoundException('Alumno no encontrado');
      targetOrgId = s.orgId;
    }

    await withOrgContext(this.db, targetOrgId, async (tx) => {
      const [student] = await tx
        .select({
          id: students.id,
          orgId: students.orgId,
          isAnonymized: students.isAnonymized,
        })
        .from(students)
        .where(eq(students.id, studentId));

      if (!student) throw new NotFoundException('Alumno no encontrado');
      if (!requestedBy.isPlatformAdmin && student.orgId !== requestedBy.orgId) {
        throw new NotFoundException('Alumno no encontrado');
      }
      if (student.isAnonymized) return; // operación idempotente

      // SHA-256 sobre el UUID del alumno (no sobre el RUT real — no reversible).
      const anon = (salt: string): string =>
        'anon-' +
        createHash('sha256')
          .update(studentId + salt)
          .digest('hex')
          .slice(0, 16);

      await tx
        .update(students)
        .set({
          rut: anon('rut'),
          firstName: 'Anon',
          lastName: anon('ln'),
          birthDate: null, // PII
          profile: {}, // elimina NEE, sensitiveNotes, etc.
          userId: null, // desvincula cuenta digital
          isAnonymized: true,
          updatedAt: new Date(),
        })
        .where(eq(students.id, studentId));

      await tx.insert(auditLogs).values({
        userId: requestedBy.userId,
        orgId: targetOrgId,
        action: requestedBy.isPlatformAdmin ? 'admin.student.anonymize' : 'anonymize_student',
        resourceType: 'students',
        resourceFilter: { studentId },
        recordCount: 1,
      });
    });
  }

  // ── Auditoría de exportaciones masivas ──────────────────────────

  /** Registra una operación sensible (exportación, anonimización) en `audit_logs`. */
  async logExport(params: {
    userId: string;
    orgId: string;
    action: string;
    resourceType: string;
    resourceFilter?: Record<string, unknown>;
    recordCount?: number;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<void> {
    await this.db.insert(auditLogs).values(params);
  }

  /**
   * Lista los registros de auditoría.
   * Si orgId es null (platform_admin sin filtro), retorna todos los logs paginados.
   */
  async listAuditLogs(orgId: string | null, limit = 100) {
    const query = this.db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);

    return orgId ? query.where(eq(auditLogs.orgId, orgId)) : query;
  }
}
