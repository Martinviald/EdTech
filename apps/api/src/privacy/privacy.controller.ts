import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { PrivacyService } from './privacy.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { getOptionalOrgId } from '../common/helpers/org-context.helper';

@Controller('privacy')
@UseGuards(RolesGuard)
export class PrivacyController {
  constructor(private readonly privacyService: PrivacyService) {}

  /** POST /api/privacy/students/:id/anonymize — Derecho al Olvido (Ley 19.628). */
  @Post('students/:id/anonymize')
  @Roles('school_admin', 'platform_admin')
  async anonymizeStudent(
    @Param('id') studentId: string,
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgIdQuery?: string,
  ) {
    await this.privacyService.anonymizeStudent(studentId, {
      userId: user.userId,
      orgId: getOptionalOrgId(user, orgIdQuery),
      isPlatformAdmin: user.isPlatformAdmin,
    });
    return { success: true, message: 'Datos del alumno anonimizados correctamente' };
  }

  /** GET /api/privacy/audit-logs — trazabilidad de operaciones sensibles. */
  @Get('audit-logs')
  @Roles('school_admin', 'academic_director', 'platform_admin', 'foundation_director')
  async getAuditLogs(
    @CurrentUser() user: JwtPayload,
    @Query('orgId') orgIdQuery?: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = limit ? Number.parseInt(limit, 10) : 100;
    const safeLimit = Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
    const orgId = getOptionalOrgId(user, orgIdQuery);
    return this.privacyService.listAuditLogs(orgId, safeLimit);
  }
}
