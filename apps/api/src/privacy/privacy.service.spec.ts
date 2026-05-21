import { NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { auditLogs, createDbClient, students } from '@soe/db';
import type { Database } from '@soe/db';
import { PrivacyService } from './privacy.service';

// El .env se carga en src/test-setup.ts vía jest.setupFiles

// IDs determinísticos del seed — ejecutar `pnpm db:seed` si la DB está vacía.
const DEMO_ORG_ID = 'dec00000-0000-0000-0000-000000000001';
const DEMO_ADMIN_USER_ID = 'dec00000-0000-0000-0000-0000000000a1';
const DEMO_STUDENT_IDS = {
  juan: 'dec00000-0000-0000-0000-000000000051',
  maria: 'dec00000-0000-0000-0000-000000000052',
} as const;

const REQUESTER = { userId: DEMO_ADMIN_USER_ID, orgId: DEMO_ORG_ID };

describe('PrivacyService', () => {
  let db: Database;
  let service: PrivacyService;

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL no configurado en .env');
    db = createDbClient(url);
    // @InjectDb es solo metadata NestJS — la instancia directa funciona en tests.
    service = new (PrivacyService as new (db: Database) => PrivacyService)(db);
  });

  afterAll(async () => {
    // Restaurar alumnos de seed modificados por los tests
    await db
      .update(students)
      .set({
        rut: '12345678-9',
        firstName: 'Juan',
        lastName: 'Pérez',
        birthDate: null,
        profile: { nee: ['dislexia'], sensitiveNotes: 'Apoyo psicopedagógico semanal' },
        userId: null,
        isAnonymized: false,
        updatedAt: new Date(),
      })
      .where(eq(students.id, DEMO_STUDENT_IDS.juan));

    await db
      .update(students)
      .set({
        firstName: 'María',
        lastName: 'González',
        rut: '98765432-1',
        isAnonymized: false,
        profile: {},
        updatedAt: new Date(),
      })
      .where(eq(students.id, DEMO_STUDENT_IDS.maria));

    // Eliminar audit_logs generados por estos tests
    await db
      .delete(auditLogs)
      .where(and(eq(auditLogs.userId, DEMO_ADMIN_USER_ID), eq(auditLogs.orgId, DEMO_ORG_ID)));
  });

  describe('anonymizeStudent', () => {
    it('reemplaza PII con hashes SHA-256 y marca isAnonymized = true', async () => {
      await service.anonymizeStudent(DEMO_STUDENT_IDS.juan, REQUESTER);

      const [updated] = await db
        .select()
        .from(students)
        .where(eq(students.id, DEMO_STUDENT_IDS.juan));

      expect(updated!.isAnonymized).toBe(true);
      expect(updated!.firstName).toBe('Anon');
      expect(updated!.rut).toMatch(/^anon-[0-9a-f]{16}$/);
      expect(updated!.lastName).toMatch(/^anon-[0-9a-f]{16}$/);
      expect(updated!.birthDate).toBeNull();
      expect(updated!.profile).toEqual({});
      expect(updated!.userId).toBeNull();
    });

    it('crea exactamente un registro en audit_logs al anonimizar', async () => {
      const logs = await db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.userId, DEMO_ADMIN_USER_ID), eq(auditLogs.action, 'anonymize_student')),
        );

      expect(logs).toHaveLength(1);
      expect(logs[0]!.resourceType).toBe('students');
      expect(logs[0]!.recordCount).toBe(1);
      expect((logs[0]!.resourceFilter as Record<string, string>).studentId).toBe(
        DEMO_STUDENT_IDS.juan,
      );
    });

    it('es idempotente: segunda llamada no falla ni duplica audit_log', async () => {
      await expect(
        service.anonymizeStudent(DEMO_STUDENT_IDS.juan, REQUESTER),
      ).resolves.toBeUndefined();

      const logs = await db
        .select()
        .from(auditLogs)
        .where(
          and(eq(auditLogs.userId, DEMO_ADMIN_USER_ID), eq(auditLogs.action, 'anonymize_student')),
        );
      expect(logs).toHaveLength(1); // sigue siendo 1, no se duplicó
    });

    it('lanza NotFoundException si el alumno pertenece a otra org', async () => {
      await expect(
        service.anonymizeStudent(DEMO_STUDENT_IDS.maria, {
          userId: DEMO_ADMIN_USER_ID,
          orgId: 'aaaaaaaa-0000-0000-0000-000000000000',
        }),
      ).rejects.toThrow(NotFoundException);

      const [unchanged] = await db
        .select({ isAnonymized: students.isAnonymized })
        .from(students)
        .where(eq(students.id, DEMO_STUDENT_IDS.maria));
      expect(unchanged!.isAnonymized).toBe(false);
    });
  });

  describe('logExport', () => {
    it('inserta un audit_log con los parámetros correctos', async () => {
      await service.logExport({
        userId: DEMO_ADMIN_USER_ID,
        orgId: DEMO_ORG_ID,
        action: 'export_students',
        resourceType: 'students',
        resourceFilter: { classGroupId: 'clase-123' },
        recordCount: 42,
      });

      const [log] = await db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'export_students'), eq(auditLogs.orgId, DEMO_ORG_ID)));

      expect(log!.recordCount).toBe(42);
      expect((log!.resourceFilter as Record<string, string>).classGroupId).toBe('clase-123');
    });
  });

  describe('listAuditLogs', () => {
    it('retorna logs de la org en orden descendente por fecha', async () => {
      const logs = await service.listAuditLogs(DEMO_ORG_ID);

      expect(logs.length).toBeGreaterThan(0);
      expect(logs.every((l) => l.orgId === DEMO_ORG_ID)).toBe(true);

      for (let i = 1; i < logs.length; i++) {
        expect(logs[i - 1]!.createdAt.getTime()).toBeGreaterThanOrEqual(
          logs[i]!.createdAt.getTime(),
        );
      }
    });

    it('respeta el parámetro limit', async () => {
      const logs = await service.listAuditLogs(DEMO_ORG_ID, 1);
      expect(logs).toHaveLength(1);
    });
  });
});
