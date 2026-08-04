import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { EncryptJWT } from 'jose';
import { hkdf } from 'crypto';
import { promisify } from 'util';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import type { Response } from 'supertest';
import { auditLogs, students } from '@soe/db';
import type { Database } from '@soe/db';
import { DATABASE_CONNECTION, DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PrivacyModule } from './privacy.module';

// test-setup.ts ya cargó el .env del root → process.env está disponible
const hkdfAsync = promisify(hkdf);

async function signToken(payload: Record<string, unknown>): Promise<string> {
  const secret = process.env.AUTH_SECRET ?? 'local-development-secret-replace-in-production';
  const derived = await hkdfAsync(
    'sha256',
    secret,
    '',
    'Auth.js Generated Encryption Key ()',
    64,
  );
  const key = new Uint8Array(derived);
  return new EncryptJWT(payload)
    .setProtectedHeader({ alg: 'dir', enc: 'A256CBC-HS512' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .encrypt(key);
}

const DEMO_ORG_ID = 'dec00000-0000-0000-0000-000000000001';
const DEMO_ADMIN_USER_ID = 'dec00000-0000-0000-0000-0000000000a1';
const DEMO_TEACHER_USER_ID = 'dec00000-0000-0000-0000-0000000000c1';

describe('PrivacyController (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let testStudentId: string;
  let adminToken: string;
  let teacherToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        // ConfigModule sin envFilePath: process.env ya fue cargado por test-setup.ts
        ConfigModule.forRoot({ isGlobal: true }),
        DatabaseModule,
        AuthModule,
        PrivacyModule,
      ],
      providers: [
        RolesGuard,
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    db = app.get<Database>(DATABASE_CONNECTION);

    // Alumno exclusivo para este suite — no afecta los del seed
    const [student] = await db
      .insert(students)
      .values({
        orgId: DEMO_ORG_ID,
        rut: '99999999-9',
        firstName: 'Test',
        lastName: 'E2E',
        profile: { sensitiveNotes: 'datos de prueba e2e' },
      })
      .returning({ id: students.id });
    testStudentId = student!.id;

    adminToken = await signToken({
      userId: DEMO_ADMIN_USER_ID,
      orgId: DEMO_ORG_ID,
      role: 'school_admin',
      email: 'admin.demo@colegiodemo.cl',
      name: 'Admin Demo',
    });
    teacherToken = await signToken({
      userId: DEMO_TEACHER_USER_ID,
      orgId: DEMO_ORG_ID,
      role: 'teacher',
      email: 'profesor.demo@colegiodemo.cl',
      name: 'Profesor Demo',
    });
  });

  afterAll(async () => {
    await db
      .delete(auditLogs)
      .where(and(eq(auditLogs.userId, DEMO_ADMIN_USER_ID), eq(auditLogs.orgId, DEMO_ORG_ID)));
    await db.delete(students).where(eq(students.id, testStudentId));
    await app.close();
  });

  // ─── GET /privacy/audit-logs ──────────────────────────────────────────────

  describe('GET /privacy/audit-logs', () => {
    it('retorna 401 sin token', () => {
      return request(app.getHttpServer()).get('/privacy/audit-logs').expect(401);
    });

    it('retorna 403 con rol teacher (insuficiente)', () => {
      return request(app.getHttpServer())
        .get('/privacy/audit-logs')
        .set('Authorization', `Bearer ${teacherToken}`)
        .expect(403);
    });

    it('retorna 200 con rol school_admin y devuelve un array', () => {
      return request(app.getHttpServer())
        .get('/privacy/audit-logs')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .expect((res: Response) => {
          expect(Array.isArray(res.body)).toBe(true);
        });
    });

    it('respeta ?limit=2', () => {
      return request(app.getHttpServer())
        .get('/privacy/audit-logs?limit=2')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
        .expect((res: Response) => {
          expect((res.body as unknown[]).length).toBeLessThanOrEqual(2);
        });
    });
  });

  // ─── POST /privacy/students/:id/anonymize ────────────────────────────────

  describe('POST /privacy/students/:id/anonymize', () => {
    it('retorna 401 sin token', () => {
      return request(app.getHttpServer())
        .post(`/privacy/students/${testStudentId}/anonymize`)
        .expect(401);
    });

    it('retorna 403 con rol teacher', () => {
      return request(app.getHttpServer())
        .post(`/privacy/students/${testStudentId}/anonymize`)
        .set('Authorization', `Bearer ${teacherToken}`)
        .expect(403);
    });

    it('anonimiza y retorna { success: true }', async () => {
      const res = await request(app.getHttpServer())
        .post(`/privacy/students/${testStudentId}/anonymize`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      expect(res.body).toMatchObject({ success: true });

      const [student] = await db.select().from(students).where(eq(students.id, testStudentId));
      expect(student!.isAnonymized).toBe(true);
      expect(student!.firstName).toBe('Anon');
    });

    it('es idempotente: segunda llamada retorna 201 sin error', () => {
      return request(app.getHttpServer())
        .post(`/privacy/students/${testStudentId}/anonymize`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201)
        .expect((res: Response) => {
          expect(res.body).toMatchObject({ success: true });
        });
    });

    it('retorna 404 para alumno inexistente', () => {
      return request(app.getHttpServer())
        .post('/privacy/students/00000000-0000-0000-0000-000000000000/anonymize')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });
});
