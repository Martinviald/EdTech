import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { desc, eq } from 'drizzle-orm';
import { auditLogs, students } from '@soe/db';
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
    requestedBy: { userId: string; orgId: string },
  ): Promise<void> {
    const [student] = await this.db
      .select({
        id: students.id,
        orgId: students.orgId,
        isAnonymized: students.isAnonymized,
      })
      .from(students)
      .where(eq(students.id, studentId));

    if (!student || student.orgId !== requestedBy.orgId) {
      throw new NotFoundException('Alumno no encontrado');
    }
    if (student.isAnonymized) return; // operación idempotente

    // SHA-256 sobre el UUID del alumno (no sobre el RUT real — no reversible).
    const anon = (salt: string): string =>
      'anon-' +
      createHash('sha256').update(studentId + salt).digest('hex').slice(0, 16);

    await this.db.transaction(async (tx) => {
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
        orgId: requestedBy.orgId,
        action: 'anonymize_student',
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

  /** Lista los registros de auditoría de una organización, más recientes primero. */
  async listAuditLogs(orgId: string, limit = 100) {
    return this.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.orgId, orgId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  }
}
